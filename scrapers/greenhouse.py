"""Greenhouse ATS scraper — public JSON API, no auth needed.

Used by many finance/quant firms: Jane Street, Point72, etc.
API: GET https://boards-api.greenhouse.io/v1/boards/{token}/jobs
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

import httpx

from .base import BaseScraper, Job, categorize_role, classify_hiring_period, classify_education_level

logger = logging.getLogger(__name__)


class GreenhouseScraper(BaseScraper):
    """Scrapes Greenhouse-powered career pages via public JSON API."""

    def __init__(self, board_config: dict, known_urls: set[str] | None = None):
        super().__init__(board_config, known_urls)
        self._board_token = board_config["board_token"]
        self._company_name = board_config["name"]

    async def scrape(self) -> list[Job]:
        api_url = f"https://boards-api.greenhouse.io/v1/boards/{self._board_token}/jobs?content=true"

        async with httpx.AsyncClient(timeout=20.0) as client:
            try:
                resp = await client.get(api_url, headers={"User-Agent": "Mozilla/5.0"})
                resp.raise_for_status()
            except httpx.HTTPError as e:
                self.logger.error("Failed to fetch %s: %s", self._company_name, e)
                return []

            data = resp.json()

        jobs_data = data.get("jobs", [])
        jobs: list[Job] = []

        for item in jobs_data:
            job = self._parse_job(item)
            if job and job.url not in self.known_urls:
                jobs.append(job)

        self.logger.info("Fetched %d jobs from %s (Greenhouse)", len(jobs), self._company_name)
        return jobs

    def _parse_job(self, item: dict) -> Job | None:
        try:
            title = item.get("title", "")
            if not title:
                return None

            job_url = item.get("absolute_url", "")
            if not job_url:
                return None

            # Location
            location_data = item.get("location", {})
            location = location_data.get("name", "Unknown") if isinstance(location_data, dict) else str(location_data)
            remote = "remote" in location.lower()

            # Posted date
            updated = item.get("updated_at") or item.get("created_at", "")
            try:
                posted_date = datetime.fromisoformat(updated.replace("Z", "+00:00"))
            except (ValueError, AttributeError):
                posted_date = datetime.now(timezone.utc)

            # Departments
            departments = item.get("departments", [])
            department = departments[0].get("name", "") if departments else None

            hiring_period = classify_hiring_period(title)
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
                industry="Financial Services",
                source_platform="greenhouse",
                hiring_period=hiring_period,
                education_level=education_level,
            )
        except Exception as e:
            self.logger.debug("Failed to parse Greenhouse job: %s", e)
            return None
