"""Main orchestrator — runs all scrapers, deduplicates, writes to Turso DB.

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
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests
import yaml
from dotenv import load_dotenv

# Add project root to path
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from scrapers.base import Job
from scrapers.consider import ConsiderScraper
from scrapers.getro import GetroScraper
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
MAX_AGE_DAYS = 30
BATCH_SIZE = 200

PLATFORM_SCRAPERS = {
    "consider": ConsiderScraper,
    "getro": GetroScraper,
}


# ── Turso DB helpers ────────────────────────────────────────────────────

def get_turso_config():
    load_dotenv(ROOT / ".env")
    url = os.getenv("TURSO_DATABASE_URL", "")
    token = os.getenv("TURSO_AUTH_TOKEN", "")
    if not url or not token:
        logger.error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must be set")
        sys.exit(1)
    return url.replace("libsql://", "https://"), token


def _to_value(v):
    if v is None:
        return {"type": "null", "value": None}
    if isinstance(v, bool):
        return {"type": "integer", "value": str(int(v))}
    if isinstance(v, int):
        return {"type": "integer", "value": str(v)}
    if isinstance(v, float):
        return {"type": "float", "value": v}
    return {"type": "text", "value": str(v)}


def execute_sql(http_url, token, statements):
    reqs = []
    for sql, args in statements:
        stmt = {"sql": sql}
        if args:
            stmt["args"] = [_to_value(a) for a in args]
        reqs.append({"type": "execute", "stmt": stmt})
    if not reqs:
        return []
    reqs.append({"type": "close"})
    resp = requests.post(
        f"{http_url}/v2/pipeline",
        json={"requests": reqs},
        headers={"Authorization": f"Bearer {token}"},
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()
    results = data.get("results", [])
    for r in results:
        if r.get("type") == "error":
            err = r.get("error", {})
            logger.error("SQL error: %s", err.get("message", err))
    return results


def job_id(url: str) -> str:
    return hashlib.sha256(url.encode()).hexdigest()[:16]


def get_known_urls(http_url, token) -> set[str]:
    results = execute_sql(http_url, token, [("SELECT url FROM jobs", None)])
    rows = results[0]["response"]["result"]["rows"]
    return {row[0]["value"] for row in rows}


def upsert_jobs(http_url, token, jobs: list[Job]):
    """Batch upsert jobs into Turso."""
    stmts = []
    vc_stmts = []

    for job in jobs:
        jid = job_id(job.url)
        skills_json = json.dumps(job.skills) if job.skills else None

        stmts.append((
            """INSERT INTO jobs (id, title, company, company_slug, company_size, company_domain,
               location, remote, hybrid, url, posted_date, seniority,
               salary_min, salary_max, salary_currency, salary_period,
               department, job_type, industry, skills, category, source_platform, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
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
               updated_at=datetime('now')""",
            [jid, job.title, job.company, job.company_slug, job.company_size,
             job.company_domain, job.location, int(job.remote), int(job.hybrid),
             job.url, job.posted_date.isoformat(), job.seniority,
             job.salary_min, job.salary_max, job.salary_currency, job.salary_period,
             job.department, job.job_type, job.industry, skills_json,
             job.category, job.source_platform],
        ))

        for vc in job.vc_backers:
            vc_stmts.append((
                "INSERT OR IGNORE INTO job_vc_backers (job_id, vc_name) VALUES (?, ?)",
                [jid, vc],
            ))

        # Flush in batches
        if len(stmts) >= BATCH_SIZE:
            execute_sql(http_url, token, stmts)
            stmts = []

    if stmts:
        execute_sql(http_url, token, stmts)

    # Insert VC backers
    for i in range(0, len(vc_stmts), BATCH_SIZE):
        execute_sql(http_url, token, vc_stmts[i:i + BATCH_SIZE])


def prune_old_jobs_db(http_url, token, max_age_days: int = MAX_AGE_DAYS):
    cutoff = (datetime.now(timezone.utc) - timedelta(days=max_age_days)).isoformat()
    results = execute_sql(http_url, token, [
        (f"DELETE FROM jobs WHERE posted_date < ?", [cutoff]),
    ])
    affected = results[0]["response"]["result"]["affected_row_count"]
    if affected:
        logger.info("Pruned %d jobs older than %d days from DB", affected, max_age_days)


def get_db_job_count(http_url, token) -> int:
    results = execute_sql(http_url, token, [("SELECT COUNT(*) FROM jobs", None)])
    return int(results[0]["response"]["result"]["rows"][0][0]["value"])


# ── Scraping ────────────────────────────────────────────────────────────

def load_config(platform_filter: str | None = None) -> list[dict]:
    with open(CONFIG_FILE) as f:
        config = yaml.safe_load(f)
    boards = config.get("boards", [])
    if platform_filter:
        boards = [b for b in boards if b.get("platform") == platform_filter]
    return boards


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
    boards = load_config(platform_filter)
    logger.info("Loaded %d board configs", len(boards))

    http_url, token = get_turso_config()

    # Get known URLs for incremental mode
    known_urls: set[str] = set()
    if not full:
        known_urls = get_known_urls(http_url, token)
        if known_urls:
            logger.info("Incremental mode: %d known URLs in DB", len(known_urls))
        else:
            logger.info("No existing data in DB — running full scrape")

    if full:
        logger.info("Full mode: clearing existing jobs")
        execute_sql(http_url, token, [
            ("DELETE FROM job_vc_backers", None),
            ("DELETE FROM jobs", None),
        ])

    # Scrape
    semaphore = asyncio.Semaphore(MAX_CONCURRENT)
    tasks = [scrape_board(board, semaphore, known_urls) for board in boards]
    results = await asyncio.gather(*tasks)

    new_jobs: list[Job] = []
    for job_list in results:
        new_jobs.extend(job_list)
    logger.info("Scraped %d new jobs", len(new_jobs))

    # Deduplicate (merges vc_backers across boards)
    unique_jobs = deduplicate(new_jobs)

    # Upsert into Turso
    logger.info("Upserting %d jobs into Turso...", len(unique_jobs))
    upsert_jobs(http_url, token, unique_jobs)

    # Prune old jobs
    prune_old_jobs_db(http_url, token)

    total = get_db_job_count(http_url, token)
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
