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

from scrapers.base import Job
from scrapers.consider import ConsiderScraper
from scrapers.getro import GetroScraper
from scrapers.simplify import SimplifyScraper
from scrapers.workday import WorkdayScraper
from scrapers.greenhouse import GreenhouseScraper
from scrapers.lever import LeverScraper
from scrapers.ashby import AshbyScraper
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
BATCH_SIZE = 100

PLATFORM_SCRAPERS = {
    "consider": ConsiderScraper,
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
    acct_id = os.getenv("CLOUDFLARE_ACCT_ID", "")
    db_id = os.getenv("CLOUDFLARE_DB_ID", "")
    api_key = os.getenv("CLOUDFLARE_API_KEY", "")
    if not acct_id or not db_id or not api_key:
        logger.error("CLOUDFLARE_ACCT_ID, CLOUDFLARE_DB_ID, and CLOUDFLARE_API_KEY must be set")
        sys.exit(1)
    url = f"https://api.cloudflare.com/client/v4/accounts/{acct_id}/d1/database/{db_id}/query"
    return url, api_key


def execute_sql(api_url, token, statements, max_retries=3):
    if not statements:
        return []
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
            resp.raise_for_status()
            break
        data = resp.json()
        if not data.get("success"):
            for err in data.get("errors", []):
                logger.error("D1 error: %s", err.get("message", err))
        result_list = data.get("result", [{}])
        results.append(result_list[0] if result_list else {})
    return results


def job_id(url: str) -> str:
    return hashlib.sha256(url.encode()).hexdigest()[:16]


def get_known_urls(api_url, token) -> set[str]:
    results = execute_sql(api_url, token, [("SELECT url FROM jobs", None)])
    rows = results[0]["results"]
    return {row["url"] for row in rows}


def upsert_jobs(http_url, token, jobs: list[Job]):
    """Batch upsert jobs into D1."""
    stmts = []
    vc_stmts = []

    for job in jobs:
        jid = job_id(job.url)
        skills_json = json.dumps(job.skills) if job.skills else None
        hiring_json = json.dumps(job.hiring_period) if job.hiring_period else None
        edu_json = json.dumps(job.education_level) if job.education_level else None

        stmts.append((
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


def prune_old_jobs_db(api_url, token, max_age_days: int = MAX_AGE_DAYS):
    cutoff = (datetime.now(timezone.utc) - timedelta(days=max_age_days)).isoformat()
    results = execute_sql(api_url, token, [
        ("DELETE FROM jobs WHERE posted_date < ?", [cutoff]),
    ])
    affected = results[0]["meta"]["changes"]
    if affected:
        logger.info("Pruned %d jobs older than %d days from DB", affected, max_age_days)


def get_db_job_count(api_url, token) -> int:
    results = execute_sql(api_url, token, [("SELECT COUNT(*) as cnt FROM jobs", None)])
    return int(results[0]["results"][0]["cnt"])


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

    api_url, token = get_d1_config()

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

    new_jobs: list[Job] = []
    for job_list in results:
        new_jobs.extend(job_list)
    logger.info("Scraped %d new jobs", len(new_jobs))

    # Deduplicate (merges vc_backers across boards)
    unique_jobs = deduplicate(new_jobs)

    # Upsert into D1
    logger.info("Upserting %d jobs into D1...", len(unique_jobs))
    upsert_jobs(api_url, token, unique_jobs)

    # Prune old jobs
    prune_old_jobs_db(api_url, token)

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
