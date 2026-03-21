"""Main orchestrator — runs all scrapers, deduplicates, outputs JSON.

Usage:
    python scripts/aggregate.py              # incremental (only fetch new jobs)
    python scripts/aggregate.py --full       # full re-scrape from scratch
    python scripts/aggregate.py --platforms getro  # only run Getro boards
"""

from __future__ import annotations

import asyncio
import json
import logging
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import yaml

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
OUTPUT_FILE = ROOT / "data" / "jobs.json"
MAX_CONCURRENT = 5
MAX_AGE_DAYS = 30  # prune jobs older than this


PLATFORM_SCRAPERS = {
    "consider": ConsiderScraper,
    "getro": GetroScraper,
}


def load_config(platform_filter: str | None = None) -> list[dict]:
    with open(CONFIG_FILE) as f:
        config = yaml.safe_load(f)

    boards = config.get("boards", [])
    if platform_filter:
        boards = [b for b in boards if b.get("platform") == platform_filter]

    return boards


def load_existing_jobs() -> list[Job]:
    """Load previously scraped jobs from data/jobs.json."""
    if not OUTPUT_FILE.exists():
        return []
    try:
        raw = json.loads(OUTPUT_FILE.read_text())
        return [Job.from_dict(j) for j in raw]
    except (json.JSONDecodeError, KeyError, TypeError) as e:
        logger.warning("Could not load existing jobs: %s", e)
        return []


def build_known_urls(jobs: list[Job]) -> set[str]:
    """Extract all known job URLs for incremental detection."""
    return {j.url for j in jobs if j.url}


def prune_old_jobs(jobs: list[Job], max_age_days: int = MAX_AGE_DAYS) -> list[Job]:
    """Remove jobs older than max_age_days to keep the dataset fresh."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=max_age_days)
    before = len(jobs)
    jobs = [j for j in jobs if j.posted_date.replace(tzinfo=timezone.utc) >= cutoff]
    pruned = before - len(jobs)
    if pruned:
        logger.info("Pruned %d jobs older than %d days", pruned, max_age_days)
    return jobs


async def scrape_board(
    board: dict,
    semaphore: asyncio.Semaphore,
    known_urls: set[str],
) -> list[Job]:
    """Scrape a single board with semaphore-based concurrency control."""
    platform = board.get("platform", "")
    scraper_cls = PLATFORM_SCRAPERS.get(platform)

    if scraper_cls is None:
        logger.debug("No scraper for platform '%s' (%s) — skipping", platform, board["name"])
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
    """Run all scrapers, deduplicate, and write output."""
    boards = load_config(platform_filter)
    logger.info("Loaded %d board configs", len(boards))

    # Load existing data for incremental mode
    existing_jobs: list[Job] = []
    known_urls: set[str] = set()

    if not full:
        existing_jobs = load_existing_jobs()
        if existing_jobs:
            known_urls = build_known_urls(existing_jobs)
            logger.info(
                "Incremental mode: %d existing jobs, %d known URLs",
                len(existing_jobs), len(known_urls),
            )
        else:
            logger.info("No existing data — running full scrape")

    # Scrape
    semaphore = asyncio.Semaphore(MAX_CONCURRENT)
    tasks = [scrape_board(board, semaphore, known_urls) for board in boards]
    results = await asyncio.gather(*tasks)

    # Flatten new jobs
    new_jobs: list[Job] = []
    for job_list in results:
        new_jobs.extend(job_list)
    logger.info("Scraped %d new jobs", len(new_jobs))

    # Merge with existing
    if existing_jobs and not full:
        all_jobs = existing_jobs + new_jobs
        logger.info("Merged: %d existing + %d new = %d total", len(existing_jobs), len(new_jobs), len(all_jobs))
    else:
        all_jobs = new_jobs

    # Deduplicate
    unique_jobs = deduplicate(all_jobs)

    # Prune old jobs
    unique_jobs = prune_old_jobs(unique_jobs)

    # Sort by posted date descending
    unique_jobs.sort(key=lambda j: j.posted_date, reverse=True)

    # Write output
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    output = [job.to_dict() for job in unique_jobs]
    OUTPUT_FILE.write_text(json.dumps(output, indent=2, default=str))
    logger.info("Wrote %d jobs to %s", len(unique_jobs), OUTPUT_FILE)


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Scrape VC job boards")
    parser.add_argument(
        "--platforms",
        type=str,
        default=None,
        help="Only scrape boards of this platform type (e.g. getro, greenhouse)",
    )
    parser.add_argument(
        "--full",
        action="store_true",
        help="Full re-scrape (ignore existing data, fetch everything)",
    )
    args = parser.parse_args()

    asyncio.run(run(platform_filter=args.platforms, full=args.full))


if __name__ == "__main__":
    main()
