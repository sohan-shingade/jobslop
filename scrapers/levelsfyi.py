"""Levels.fyi internship scraper — fetches internship compensation data.

Source: https://www.levels.fyi/js/internshipData.json
~13K internship entries with salary data.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

import httpx

from .base import BaseScraper, Job, categorize_role

logger = logging.getLogger(__name__)

DATA_URL = "https://www.levels.fyi/js/internshipData.json"


class LevelsFyiScraper(BaseScraper):
    """Scrapes Levels.fyi internship compensation data."""

    def __init__(self, board_config: dict, known_urls: set[str] | None = None):
        super().__init__(board_config, known_urls)

    async def scrape(self) -> list[Job]:
        async with httpx.AsyncClient(timeout=30.0) as client:
            try:
                resp = await client.get(DATA_URL, headers={
                    "User-Agent": "Mozilla/5.0",
                    "Accept-Encoding": "gzip, deflate",
                })
                resp.raise_for_status()
            except httpx.HTTPError as e:
                self.logger.error("Failed to fetch Levels.fyi data: %s", e)
                return []

            listings = resp.json()

        jobs: list[Job] = []
        skipped = 0

        for item in listings:
            # Only recent years and open applications
            yr = item.get("yr", "")
            if yr and int(yr) < 2025:
                continue
            if item.get("appNotOpen", False):
                continue

            link = item.get("link", "")
            if not link or link in self.known_urls:
                skipped += 1
                continue

            job = self._parse_listing(item)
            if job:
                jobs.append(job)

        self.logger.info(
            "Fetched %d jobs from Levels.fyi (%d skipped)",
            len(jobs), skipped,
        )
        return jobs

    def _parse_listing(self, item: dict) -> Job | None:
        try:
            company = item.get("company", "")
            title = item.get("title", "")
            if not company or not title:
                return None

            # Add "Intern" to title if not already there
            if "intern" not in title.lower():
                title = f"{title} Intern"

            link = item.get("link", "")
            location = item.get("loc", "Unknown")
            remote = "remote" in location.lower()

            # Salary — Levels.fyi gives monthly/hourly
            monthly = item.get("monthlySalary")
            hourly = item.get("hourlySalary")
            salary_min = None
            salary_max = None
            salary_currency = "USD"
            salary_period = "year"

            if monthly and monthly > 0:
                # Assume 3-month internship, annualize: monthly * 12
                salary_min = int(monthly * 12 * 100)  # cents
                salary_max = salary_min
            elif hourly and hourly > 0:
                # ~2080 hours/year
                salary_min = int(hourly * 2080 * 100)  # cents
                salary_max = salary_min

            season = item.get("season", "Summer")

            return Job(
                company=company,
                title=title,
                location=location,
                url=link,
                posted_date=datetime.now(timezone.utc),
                vc_backers=[self.name],
                category=categorize_role(title),
                remote=remote,
                seniority="Intern",
                job_type="Internship",
                salary_min=salary_min,
                salary_max=salary_max,
                salary_currency=salary_currency,
                salary_period=salary_period,
                source_platform="levelsfyi",
            )
        except Exception as e:
            self.logger.debug("Failed to parse Levels.fyi listing: %s", e)
            return None
