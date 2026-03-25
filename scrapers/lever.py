"""Lever ATS scraper — public JSON API, no auth needed.

Used by crypto firms: Anchorage Digital, Wintermute, Offchain Labs, etc.
API: GET https://api.lever.co/v0/postings/{company}
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

import httpx

from .base import BaseScraper, Job, categorize_role, classify_hiring_period, classify_education_level

logger = logging.getLogger(__name__)


class LeverScraper(BaseScraper):
    """Scrapes Lever-powered career pages via public JSON API."""

    def __init__(self, board_config: dict, known_urls: set[str] | None = None):
        super().__init__(board_config, known_urls)
        self._board_token = board_config["board_token"]
        self._company_name = board_config["name"]
        self._industry = board_config.get("industry", "Crypto")

    async def scrape(self) -> list[Job]:
        api_url = f"https://api.lever.co/v0/postings/{self._board_token}?mode=json"

        async with httpx.AsyncClient(timeout=20.0) as client:
            try:
                resp = await client.get(api_url, headers={"User-Agent": "Mozilla/5.0"})
                resp.raise_for_status()
            except httpx.HTTPError as e:
                self.logger.error("Failed to fetch %s: %s", self._company_name, e)
                return []

            data = resp.json()

        if not isinstance(data, list):
            self.logger.warning("Unexpected response format from %s", self._company_name)
            return []

        jobs: list[Job] = []
        for item in data:
            job = self._parse_job(item)
            if job and job.url not in self.known_urls:
                jobs.append(job)

        self.logger.info("Fetched %d jobs from %s (Lever)", len(jobs), self._company_name)
        return jobs

    def _parse_job(self, item: dict) -> Job | None:
        try:
            title = item.get("text", "")
            if not title:
                return None

            job_url = item.get("hostedUrl", "")
            if not job_url:
                return None

            # Categories
            categories = item.get("categories", {})
            location = categories.get("location", "Unknown") or "Unknown"
            department = categories.get("department") or categories.get("team")
            commitment = categories.get("commitment", "")

            # Remote detection
            workplace = item.get("workplaceType", "")
            remote = workplace == "remote" or "remote" in location.lower()

            # Posted date (Lever uses milliseconds since epoch)
            created_at = item.get("createdAt", 0)
            try:
                posted_date = datetime.fromtimestamp(created_at / 1000, tz=timezone.utc)
            except (ValueError, OSError):
                posted_date = datetime.now(timezone.utc)

            # Job type from commitment field
            job_type = commitment if commitment else None

            hiring_period = classify_hiring_period(title, job_type=job_type)
            education_level = classify_education_level(title)

            return Job(
                company=self._company_name,
                title=title,
                location=location,
                url=job_url,
                posted_date=posted_date,
                vc_backers=[self.name],
                category=categorize_role(title),
                remote=remote,
                department=department,
                job_type=job_type,
                industry=self._industry,
                source_platform="lever",
                hiring_period=hiring_period,
                education_level=education_level,
            )
        except Exception as e:
            self.logger.debug("Failed to parse Lever job: %s", e)
            return None
