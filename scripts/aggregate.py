"""Main orchestrator — runs all scrapers, deduplicates, writes to Cloudflare D1.

Usage:
    python scripts/aggregate.py              # incremental (only fetch new jobs)
    python scripts/aggregate.py --full       # full re-scrape from scratch
    python scripts/aggregate.py --platforms getro  # only run Getro boards
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import sqlite3
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests
import yaml
from dotenv import load_dotenv

# Add project root to path
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from scrapers.base import MAX_AGE_DAYS, Job
from scrapers.consider import ConsiderScraper
from scrapers.getro import GetroScraper
from scrapers.simplify import SimplifyScraper
from scrapers.workday import WorkdayScraper
from scrapers.greenhouse import GreenhouseScraper
from scrapers.lever import LeverScraper
from scrapers.ashby import AshbyScraper
from scrapers.greylock import GreylockScraper
from scripts.deduplicate import deduplicate

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
logging.getLogger("httpx").setLevel(logging.WARNING)
logger = logging.getLogger(__name__)

CONFIG_FILE = ROOT / "config" / "vc_boards.yaml"
MAX_CONCURRENT = 5
MAX_JOBS = 20_000  # D1 free tier allows 5M rows read a day; every full scan costs one read per row
# D1 free tier allows 100k rows written a day, and each job costs about 12 (table, indexes, backers).
# We run 4 times a day. Cleanup may use half of a run's budget so new jobs always get the rest.
WRITE_BUDGET = 20_000
DELETE_BATCH = 100
rows_written = 0

PLATFORM_SCRAPERS = {
    "consider": ConsiderScraper,
    "greylock": GreylockScraper,
    "getro": GetroScraper,
    "simplify": SimplifyScraper,
    "workday": WorkdayScraper,
    "greenhouse": GreenhouseScraper,
    "lever": LeverScraper,
    "ashby": AshbyScraper,
}


# ── Cloudflare D1 helpers ──────────────────────────────────────────────

def get_d1_config():
    load_dotenv(ROOT / ".env")
    if os.getenv("JOBSLOP_SQLITE"):
        return "", ""
    acct_id = os.getenv("CLOUDFLARE_ACCT_ID", "")
    db_id = os.getenv("CLOUDFLARE_DB_ID", "")
    api_key = os.getenv("CLOUDFLARE_API_KEY", "")
    if not acct_id or not db_id or not api_key:
        logger.error("CLOUDFLARE_ACCT_ID, CLOUDFLARE_DB_ID, and CLOUDFLARE_API_KEY must be set")
        sys.exit(1)
    url = f"https://api.cloudflare.com/client/v4/accounts/{acct_id}/d1/database/{db_id}/query"
    return url, api_key


local_db = None


def execute_local(statements):
    """Same result shape as D1, against a SQLite file. No write budget applies."""
    global local_db
    if local_db is None:
        path = Path(os.environ["JOBSLOP_SQLITE"])
        path.parent.mkdir(parents=True, exist_ok=True)
        local_db = sqlite3.connect(path)
        local_db.row_factory = sqlite3.Row
        local_db.execute("PRAGMA journal_mode=WAL")
        local_db.execute("PRAGMA foreign_keys=ON")
        local_db.executescript((ROOT / "db/schema.sql").read_text())
    results = []
    for sql, args in statements:
        cur = local_db.execute(sql, args or [])
        rows = [dict(r) for r in cur.fetchall()] if cur.description else []
        results.append({"results": rows, "meta": {"changes": max(cur.rowcount, 0)}})
    local_db.commit()
    return results


def execute_sql(api_url, token, statements, max_retries=3):
    if not statements:
        return []
    if os.getenv("JOBSLOP_SQLITE"):
        return execute_local(statements)
    results = []
    for sql, args in statements:
        body = {"sql": sql}
        if args:
            body["params"] = args
        for attempt in range(max_retries + 1):
            resp = requests.post(
                api_url,
                json=body,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
                timeout=60,
            )
            if resp.status_code in (401, 429) or resp.status_code >= 500:
                if attempt < max_retries:
                    wait = 2 ** attempt
                    logger.warning("D1 returned %d, retrying in %ds (attempt %d/%d)",
                                   resp.status_code, wait, attempt + 1, max_retries)
                    time.sleep(wait)
                    continue
            if not resp.ok:
                logger.error("D1 returned %d: %s", resp.status_code, resp.text[:500])
            resp.raise_for_status()
            break
        data = resp.json()
        if not data.get("success"):
            for err in data.get("errors", []):
                logger.error("D1 error: %s", err.get("message", err))
        result_list = data.get("result", [{}])
        result = result_list[0] if result_list else {}
        global rows_written
        rows_written += result.get("meta", {}).get("rows_written", 0)
        results.append(result)
    return results


def job_id(url: str) -> str:
    return hashlib.sha256(url.encode()).hexdigest()[:16]


def get_known_urls(api_url, token) -> set[str]:
    results = execute_sql(api_url, token, [("SELECT url FROM jobs", None)])
    rows = results[0]["results"]
    return {row["url"] for row in rows}


def upsert_jobs(http_url, token, jobs: list[Job]):
    """Upsert jobs into D1, newest first, until this run's write budget is used."""
    for done, job in enumerate(jobs):
        if rows_written >= WRITE_BUDGET:
            logger.info("Write budget used; %d jobs left for the next run", len(jobs) - done)
            return
        jid = job_id(job.url)
        skills_json = json.dumps(job.skills) if job.skills else None
        hiring_json = json.dumps(job.hiring_period) if job.hiring_period else None
        edu_json = json.dumps(job.education_level) if job.education_level else None

        stmts = [(
            """INSERT INTO jobs (id, title, company, company_slug, company_size, company_domain,
               location, remote, hybrid, url, posted_date, seniority,
               salary_min, salary_max, salary_currency, salary_period,
               department, job_type, industry, skills, category, source_platform,
               hiring_period, education_level, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
               ON CONFLICT(id) DO UPDATE SET
               title=excluded.title, company=excluded.company, company_slug=excluded.company_slug,
               company_size=COALESCE(excluded.company_size, company_size),
               company_domain=COALESCE(excluded.company_domain, company_domain),
               location=excluded.location, remote=excluded.remote, hybrid=excluded.hybrid,
               posted_date=excluded.posted_date,
               seniority=COALESCE(excluded.seniority, seniority),
               salary_min=COALESCE(excluded.salary_min, salary_min),
               salary_max=COALESCE(excluded.salary_max, salary_max),
               salary_currency=COALESCE(excluded.salary_currency, salary_currency),
               salary_period=COALESCE(excluded.salary_period, salary_period),
               department=COALESCE(excluded.department, department),
               job_type=COALESCE(excluded.job_type, job_type),
               industry=COALESCE(excluded.industry, industry),
               skills=COALESCE(excluded.skills, skills),
               category=excluded.category, source_platform=excluded.source_platform,
               hiring_period=COALESCE(excluded.hiring_period, hiring_period),
               education_level=COALESCE(excluded.education_level, education_level),
               updated_at=datetime('now')""",
            [jid, job.title, job.company, job.company_slug, job.company_size,
             job.company_domain, job.location, int(job.remote), int(job.hybrid),
             job.url, job.posted_date.isoformat(), job.seniority,
             job.salary_min, job.salary_max, job.salary_currency, job.salary_period,
             job.department, job.job_type, job.industry, skills_json,
             job.category, job.source_platform, hiring_json, edu_json],
        )]
        stmts += [
            ("INSERT OR IGNORE INTO job_vc_backers (job_id, vc_name) VALUES (?, ?)", [jid, vc])
            for vc in job.vc_backers
        ]
        execute_sql(http_url, token, stmts)


def age_cutoff() -> str:
    return (datetime.now(timezone.utc) - timedelta(days=MAX_AGE_DAYS)).isoformat()


def clean_db(api_url, token, blocked: list[str]):
    """Keep the table small and free of blocked companies. Safe to run any time; resumes next run."""
    marks = ",".join("?" for _ in blocked)
    rules = [
        (f"SELECT id FROM jobs WHERE company IN ({marks}) LIMIT {DELETE_BATCH}", blocked),
        (f"SELECT id FROM jobs WHERE posted_date < ? OR posted_date IS NULL ORDER BY posted_date LIMIT {DELETE_BATCH}", [age_cutoff()]),
    ]
    if not os.getenv("JOBSLOP_SQLITE"):
        rules.append((f"SELECT id FROM jobs ORDER BY posted_date DESC LIMIT {DELETE_BATCH} OFFSET {MAX_JOBS}", None))
    removed = 0
    for pick, args in rules:
        while rows_written < WRITE_BUDGET // 2:
            result = execute_sql(api_url, token, [(f"DELETE FROM jobs WHERE id IN ({pick})", args)])[0]
            changes = result["meta"]["changes"]
            removed += changes
            if not changes:
                break
    if removed:
        logger.info("Removed %d old or blocked jobs from DB", removed)


def get_db_job_count(api_url, token) -> int:
    results = execute_sql(api_url, token, [("SELECT COUNT(*) as cnt FROM jobs", None)])
    return int(results[0]["results"][0]["cnt"])


# ── Scraping ────────────────────────────────────────────────────────────

def load_config(platform_filter: str | None = None) -> tuple[list[dict], list[str]]:
    with open(CONFIG_FILE) as f:
        config = yaml.safe_load(f)
    boards = config.get("boards", [])
    if platform_filter:
        boards = [b for b in boards if b.get("platform") == platform_filter]
    return boards, config.get("blocked_companies") or []


async def scrape_board(
    board: dict,
    semaphore: asyncio.Semaphore,
    known_urls: set[str],
) -> list[Job]:
    platform = board.get("platform", "")
    scraper_cls = PLATFORM_SCRAPERS.get(platform)
    if scraper_cls is None:
        return []

    async with semaphore:
        scraper = scraper_cls(board, known_urls=known_urls)
        try:
            jobs = await scraper.scrape()
            logger.info("✓ %s: %d jobs", board["name"], len(jobs))
            return jobs
        except Exception as e:
            logger.error("✗ %s failed: %s", board["name"], e)
            return []


async def run(
    platform_filter: str | None = None,
    full: bool = False,
) -> None:
    boards, blocked = load_config(platform_filter)
    logger.info("Loaded %d board configs", len(boards))

    api_url, token = get_d1_config()

    # Clean first: a failed scrape must never stop the cleanup
    clean_db(api_url, token, blocked)

    # Get known URLs for incremental mode
    known_urls: set[str] = set()
    if not full:
        known_urls = get_known_urls(api_url, token)
        if known_urls:
            logger.info("Incremental mode: %d known URLs in DB", len(known_urls))
        else:
            logger.info("No existing data in DB — running full scrape")

    if full:
        logger.info("Full mode: clearing existing jobs")
        execute_sql(api_url, token, [
            ("DELETE FROM job_vc_backers", None),
            ("DELETE FROM jobs", None),
        ])

    # Scrape
    semaphore = asyncio.Semaphore(MAX_CONCURRENT)
    tasks = [scrape_board(board, semaphore, known_urls) for board in boards]
    results = await asyncio.gather(*tasks)

    # Skip jobs cleanup would delete anyway: re-adding them every run is what used up the write limit.
    cutoff = age_cutoff()
    new_jobs: list[Job] = []
    for job_list in results:
        new_jobs.extend(
            j for j in job_list
            if j.company not in blocked and j.posted_date.isoformat() >= cutoff
        )
    logger.info("Scraped %d new jobs", len(new_jobs))

    # Deduplicate (merges vc_backers across boards)
    unique_jobs = deduplicate(new_jobs)
    unique_jobs.sort(key=lambda j: j.posted_date.isoformat(), reverse=True)

    # Upsert into D1
    logger.info("Upserting %d jobs into D1...", len(unique_jobs))
    upsert_jobs(api_url, token, unique_jobs)

    clean_db(api_url, token, blocked)

    total = get_db_job_count(api_url, token)
    logger.info("Done. %d total jobs in DB.", total)


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Scrape VC job boards")
    parser.add_argument(
        "--platforms", type=str, default=None,
        help="Only scrape boards of this platform type (e.g. getro, consider)",
    )
    parser.add_argument(
        "--full", action="store_true",
        help="Full re-scrape (clear DB, fetch everything)",
    )
    args = parser.parse_args()
    asyncio.run(run(platform_filter=args.platforms, full=args.full))


if __name__ == "__main__":
    main()
