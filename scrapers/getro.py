"""Getro-powered VC job board scraper.

Covers boards like General Catalyst, Accel, Thrive Capital, Insight Partners, etc.
These boards are Next.js apps that embed job data in __NEXT_DATA__.

Strategy:
1. Fetch the page HTML and extract __NEXT_DATA__ for the initial batch of jobs
   plus the network_id.
2. Use the Getro API with discovered network_id for paginated access if possible.
3. Fall back to the initial batch if API requires auth.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from datetime import datetime, timedelta, timezone

import httpx

from .base import MAX_AGE_DAYS, BaseScraper, Job, categorize_role, classify_hiring_period, classify_education_level

logger = logging.getLogger(__name__)

RATE_LIMIT_DELAY = 1.0
MAX_PAGES = 3000  # safety limit


class GetroScraper(BaseScraper):
    """Scrapes Getro-powered VC job boards via __NEXT_DATA__ and API."""

    def __init__(self, board_config: dict, known_urls: set[str] | None = None):
        super().__init__(board_config, known_urls)
        self._network_id: int | None = board_config.get("network_id")

    async def scrape(self) -> list[Job]:
        if self._network_id is None:
            page_data = await self._fetch_page_data()
            if page_data is None:
                return []
            nid = page_data.get("props", {}).get("pageProps", {}).get("network", {}).get("id")
            if not nid:
                self.logger.error("Could not find the Getro network id for %s", self.name)
                return []
            self._network_id = int(nid)

        jobs = await self._search_jobs()
        self.logger.info("Fetched %d jobs from %s", len(jobs), self.name)
        return jobs

    async def _search_jobs(self) -> list[Job]:
        """Page through the board's job search, newest first, until jobs are too old or already known."""
        jobs: list[Job] = []
        cutoff = datetime.now(timezone.utc) - timedelta(days=MAX_AGE_DAYS)
        url = f"https://api.getro.com/api/v2/collections/{self._network_id}/search/jobs"

        async with httpx.AsyncClient(timeout=30.0) as client:
            for page in range(MAX_PAGES):
                try:
                    resp = await client.post(
                        url,
                        json={"hitsPerPage": 20, "page": page, "filters": {"page": page}, "query": ""},
                        headers={"Accept": "application/json", "User-Agent": "Mozilla/5.0"},
                    )
                    resp.raise_for_status()
                except httpx.HTTPError as e:
                    self.logger.error("Getro search failed for %s page %d: %s", self.name, page, e)
                    break

                parsed = [j for j in map(self._parse_getro_job, resp.json()["results"]["jobs"]) if j]
                if not parsed:
                    break
                new = [j for j in parsed if j.url not in self.known_urls]
                jobs.extend(new)
                if not new or min(j.posted_date for j in parsed) < cutoff:
                    break
                await asyncio.sleep(RATE_LIMIT_DELAY)
        return jobs

    async def _fetch_page_data(self) -> dict | None:
        """Fetch the board page and parse __NEXT_DATA__."""
        async with httpx.AsyncClient(
            follow_redirects=True, timeout=20.0
        ) as client:
            try:
                resp = await client.get(
                    self.url,
                    headers={"User-Agent": "Mozilla/5.0"},
                )
                resp.raise_for_status()
            except httpx.HTTPError as e:
                self.logger.error("Failed to fetch %s: %s", self.url, e)
                return None

            match = re.search(
                r'<script\s+id="__NEXT_DATA__"[^>]*>(.*?)</script>',
                resp.text,
                re.DOTALL,
            )
            if not match:
                self.logger.warning("No __NEXT_DATA__ found on %s", self.url)
                return None

            try:
                return json.loads(match.group(1))
            except json.JSONDecodeError:
                self.logger.error("Failed to parse __NEXT_DATA__ JSON on %s", self.url)
                return None

    def _parse_getro_job(self, item: dict) -> Job | None:
        """Convert a Getro job item into a Job dataclass."""
        try:
            title = item.get("title", "")
            if not title:
                return None

            org = item.get("organization", {})
            company_name = org.get("name", "Unknown")

            # Locations
            locations = item.get("locations", [])
            if isinstance(locations, list) and locations:
                location_str = " / ".join(str(l) for l in locations[:3])
            else:
                location_str = "Unknown"

            # Remote
            work_mode = item.get("work_mode", "")
            remote = work_mode == "remote" or "remote" in title.lower()
            if not remote and isinstance(locations, list):
                remote = any("remote" in str(l).lower() for l in locations)

            # URL
            job_url = item.get("url", "")

            # Posted date — Getro uses created_at (unix timestamp)
            created_at = item.get("created_at")
            if isinstance(created_at, (int, float)):
                posted_date = datetime.fromtimestamp(created_at, tz=timezone.utc)
            elif isinstance(created_at, str):
                try:
                    posted_date = datetime.fromisoformat(
                        created_at.replace("Z", "+00:00")
                    )
                except ValueError:
                    posted_date = datetime.now(timezone.utc)
            else:
                posted_date = datetime.now(timezone.utc)

            # Enriched fields
            hybrid = work_mode == "hybrid"
            company_slug = org.get("slug")
            headcount = org.get("head_count")
            headcount_map = {1: "1-10", 2: "11-50", 3: "51-200", 4: "201-500", 5: "501-1000"}
            company_size = headcount_map.get(headcount, f"{headcount}") if headcount else None
            seniority = item.get("seniority")
            industry_tags = org.get("industry_tags", [])
            industry = industry_tags[0] if industry_tags else None
            skills_raw = item.get("skills", [])
            skills = [s if isinstance(s, str) else s.get("label", "") for s in skills_raw] if skills_raw else []

            return Job(
                company=company_name,
                title=title,
                location=location_str,
                url=job_url,
                posted_date=posted_date,
                vc_backers=[self.name],
                category=categorize_role(title),
                remote=remote,
                hybrid=hybrid,
                company_slug=company_slug,
                company_size=company_size,
                seniority=seniority,
                industry=industry,
                skills=skills,
                source_platform="getro",
                hiring_period=classify_hiring_period(title, seniority),
                education_level=classify_education_level(title),
            )
        except Exception as e:
            self.logger.debug("Failed to parse Getro job: %s", e)
            return None
