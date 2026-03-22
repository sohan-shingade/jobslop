"""SimplifyJobs scraper — fetches internship and new grad listings from GitHub JSON.

Sources:
- Summer2026-Internships: ~19K listings (~5K active)
- New-Grad-Positions: ~14K listings

Data is structured JSON at:
  https://raw.githubusercontent.com/SimplifyJobs/{repo}/dev/.github/scripts/listings.json
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

import httpx

from .base import BaseScraper, Job, categorize_role

logger = logging.getLogger(__name__)

SOURCES = {
    "simplify_internships": {
        "name": "SimplifyJobs Internships",
        "url": "https://raw.githubusercontent.com/SimplifyJobs/Summer2026-Internships/dev/.github/scripts/listings.json",
        "default_seniority": "Intern",
        "default_job_type": "Internship",
    },
    "simplify_newgrad": {
        "name": "SimplifyJobs New Grad",
        "url": "https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/.github/scripts/listings.json",
        "default_seniority": "Junior",
        "default_job_type": "Full-time",
    },
}

CATEGORY_MAP = {
    "Software": "SWE",
    "AI/ML/Data": "Data Science",
    "Quant": "Quant",
    "PM": "PM",
    "Hardware": "Other",
}


class SimplifyScraper(BaseScraper):
    """Scrapes SimplifyJobs GitHub repos for internship and new grad listings."""

    def __init__(self, board_config: dict, known_urls: set[str] | None = None):
        super().__init__(board_config, known_urls)
        self._source_key = board_config.get("source_key", "simplify_internships")
        self._source = SOURCES[self._source_key]

    async def scrape(self) -> list[Job]:
        async with httpx.AsyncClient(timeout=30.0) as client:
            try:
                resp = await client.get(
                    self._source["url"],
                    headers={"User-Agent": "Mozilla/5.0"},
                )
                resp.raise_for_status()
            except httpx.HTTPError as e:
                self.logger.error("Failed to fetch %s: %s", self._source["name"], e)
                return []

            listings = resp.json()

        jobs: list[Job] = []
        skipped_known = 0

        for item in listings:
            if not item.get("active", False):
                continue
            if not item.get("is_visible", True):
                continue

            url = item.get("url", "")
            if not url:
                continue

            # Incremental: skip known URLs
            if url in self.known_urls:
                skipped_known += 1
                continue

            job = self._parse_listing(item)
            if job:
                jobs.append(job)

        self.logger.info(
            "Fetched %d active jobs from %s (%d already known)",
            len(jobs), self._source["name"], skipped_known,
        )
        return jobs

    def _parse_listing(self, item: dict) -> Job | None:
        try:
            title = item.get("title", "")
            company = item.get("company_name", "")
            if not title or not company:
                return None

            url = item.get("url", "")
            locations = item.get("locations", [])
            location_str = " / ".join(locations[:3]) if locations else "Unknown"

            remote = any("remote" in l.lower() for l in locations)

            # Posted date from unix timestamp
            posted_ts = item.get("date_posted")
            if isinstance(posted_ts, (int, float)):
                posted_date = datetime.fromtimestamp(posted_ts, tz=timezone.utc)
            else:
                posted_date = datetime.now(timezone.utc)

            # Category
            raw_category = item.get("category", "")
            category = CATEGORY_MAP.get(raw_category, "Other")

            # Sponsorship
            sponsorship = item.get("sponsorship", "")

            return Job(
                company=company,
                title=title,
                location=location_str,
                url=url,
                posted_date=posted_date,
                vc_backers=[self.name],
                category=category,
                remote=remote,
                seniority=self._source["default_seniority"],
                job_type=self._source["default_job_type"],
                source_platform="simplify",
            )
        except Exception as e:
            self.logger.debug("Failed to parse SimplifyJobs listing: %s", e)
            return None
