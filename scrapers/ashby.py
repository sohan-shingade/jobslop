"""Ashby ATS scraper — public JSON API, no auth needed.

Used by crypto firms: Chainalysis, Paxos, Phantom, Uniswap, etc.
API: GET https://api.ashbyhq.com/posting-api/job-board/{company}
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

import httpx

from .base import BaseScraper, Job, categorize_role, classify_hiring_period, classify_education_level

logger = logging.getLogger(__name__)


class AshbyScraper(BaseScraper):
    """Scrapes Ashby-powered career pages via public JSON API."""

    def __init__(self, board_config: dict, known_urls: set[str] | None = None):
        super().__init__(board_config, known_urls)
        self._board_token = board_config["board_token"]
        self._company_name = board_config["name"]
        self._industry = board_config.get("industry", "Crypto")

    async def scrape(self) -> list[Job]:
        api_url = f"https://api.ashbyhq.com/posting-api/job-board/{self._board_token}"

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

        self.logger.info("Fetched %d jobs from %s (Ashby)", len(jobs), self._company_name)
        return jobs

    def _parse_job(self, item: dict) -> Job | None:
        try:
            title = item.get("title", "")
            if not title:
                return None

            job_url = item.get("jobUrl", "")
            if not job_url:
                return None

            # Location handling — can be string or dict
            location = item.get("location", "Unknown") or "Unknown"
            if isinstance(location, dict):
                location = location.get("name", "Unknown")

            # Append secondary locations
            secondary = item.get("secondaryLocations", [])
            if secondary:
                sec_names = []
                for loc in secondary:
                    if isinstance(loc, dict):
                        sec_names.append(loc.get("name", ""))
                    elif isinstance(loc, str):
                        sec_names.append(loc)
                extras = [s for s in sec_names if s]
                if extras:
                    location = " / ".join([location] + extras[:2])

            # Remote
            remote = bool(item.get("isRemote", False)) or "remote" in location.lower()

            # Department — can be string or dict
            department = item.get("department", None)
            if isinstance(department, dict):
                department = department.get("name")
            team = item.get("team", None)
            if isinstance(team, dict):
                team = team.get("name")
            department = department or team

            # Employment type
            emp_type = item.get("employmentType", "")
            job_type = None
            if emp_type:
                type_map = {
                    "FullTime": "Full-time",
                    "PartTime": "Part-time",
                    "Intern": "Internship",
                    "Contract": "Contract",
                    "Temporary": "Temporary",
                }
                job_type = type_map.get(emp_type, emp_type)

            # Posted date
            published = item.get("publishedAt", "")
            try:
                posted_date = datetime.fromisoformat(published.replace("Z", "+00:00"))
            except (ValueError, AttributeError):
                posted_date = datetime.now(timezone.utc)

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
                source_platform="ashby",
                hiring_period=hiring_period,
                education_level=education_level,
            )
        except Exception as e:
            self.logger.debug("Failed to parse Ashby job: %s", e)
            return None
