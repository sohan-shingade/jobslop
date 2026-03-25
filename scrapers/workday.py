"""Workday career site scraper — generic scraper for any Workday-powered job board.

Many banks and financial firms use Workday for their career pages.
The API pattern is: POST /wday/cxs/{company}/{site}/jobs
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

import httpx

from .base import BaseScraper, Job, categorize_role, classify_hiring_period, classify_education_level

logger = logging.getLogger(__name__)


class WorkdayScraper(BaseScraper):
    """Scrapes Workday-powered career sites."""

    def __init__(self, board_config: dict, known_urls: set[str] | None = None):
        super().__init__(board_config, known_urls)
        self._api_url = board_config["api_url"]
        self._base_url = board_config.get("base_url", "")
        self._company_name = board_config["name"]
        self._search_terms = board_config.get("search_terms", ["intern", "analyst", "associate", "graduate"])
        self._max_results = board_config.get("max_results", 200)

    async def scrape(self) -> list[Job]:
        all_jobs: list[Job] = []
        seen_paths: set[str] = set()

        async with httpx.AsyncClient(timeout=20.0) as client:
            for term in self._search_terms:
                offset = 0
                while offset < self._max_results:
                    try:
                        resp = await client.post(
                            self._api_url,
                            json={
                                "appliedFacets": {},
                                "limit": 20,
                                "offset": offset,
                                "searchText": term,
                            },
                            headers={"Content-Type": "application/json"},
                        )
                        if resp.status_code != 200:
                            break
                        data = resp.json()
                    except Exception as e:
                        self.logger.debug("Workday API error for %s: %s", self._company_name, e)
                        break

                    postings = data.get("jobPostings", [])
                    if not postings:
                        break

                    for posting in postings:
                        path = posting.get("externalPath", "")
                        if path in seen_paths:
                            continue
                        seen_paths.add(path)

                        job = self._parse_posting(posting)
                        if job and job.url not in self.known_urls:
                            all_jobs.append(job)

                    total = data.get("total", 0)
                    offset += 20
                    if offset >= total:
                        break

        self.logger.info("Fetched %d jobs from %s (Workday)", len(all_jobs), self._company_name)
        return all_jobs

    def _parse_posting(self, posting: dict) -> Job | None:
        try:
            title = posting.get("title", "")
            if not title:
                return None

            path = posting.get("externalPath", "")
            job_url = f"{self._base_url}{path}" if self._base_url and path else ""
            if not job_url:
                return None

            location = posting.get("locationsText", "Unknown")
            remote = "remote" in location.lower()

            # Parse posted date
            posted_text = posting.get("postedOn", "")
            posted_date = datetime.now(timezone.utc)
            if "Posted 30+ Days Ago" in posted_text:
                pass  # keep as now, will be pruned
            elif posted_text:
                # "Posted Yesterday", "Posted 2 Days Ago", etc.
                posted_date = datetime.now(timezone.utc)

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
                industry="Financial Services",
                source_platform="workday",
                hiring_period=hiring_period,
                education_level=education_level,
            )
        except Exception as e:
            self.logger.debug("Failed to parse Workday posting: %s", e)
            return None
