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
from datetime import datetime, timezone

import httpx

from .base import BaseScraper, Job, categorize_role, classify_hiring_period, classify_education_level

logger = logging.getLogger(__name__)

RATE_LIMIT_DELAY = 2.0


class GetroScraper(BaseScraper):
    """Scrapes Getro-powered VC job boards via __NEXT_DATA__ and API."""

    def __init__(self, board_config: dict, known_urls: set[str] | None = None):
        super().__init__(board_config, known_urls)
        self._network_id: int | None = board_config.get("network_id")

    async def scrape(self) -> list[Job]:
        page_data = await self._fetch_page_data()
        if page_data is None:
            return []

        # Extract initial jobs from __NEXT_DATA__
        jobs = self._extract_jobs_from_next_data(page_data)

        # Discover network_id if not configured
        if self._network_id is None:
            network = page_data.get("props", {}).get("pageProps", {}).get("network", {})
            nid = network.get("id")
            if nid:
                try:
                    self._network_id = int(nid)
                except (ValueError, TypeError):
                    pass

        # Try paginated API fetch if we have a network_id and initial batch was limited
        total = self._get_total_from_next_data(page_data)
        if self._network_id and total and len(jobs) < total:
            api_jobs = await self._fetch_via_api()
            if len(api_jobs) > len(jobs):
                jobs = api_jobs

        self.logger.info(
            "Fetched %d jobs from %s (total available: %s)",
            len(jobs), self.name, total or "?"
        )
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

    def _extract_jobs_from_next_data(self, data: dict) -> list[Job]:
        """Extract jobs from the __NEXT_DATA__ initialState."""
        jobs: list[Job] = []

        try:
            initial = data["props"]["pageProps"]["initialState"]
            jobs_data = initial.get("jobs", {})
            found = jobs_data.get("found", [])
        except (KeyError, TypeError):
            self.logger.warning("Unexpected __NEXT_DATA__ structure for %s", self.name)
            return jobs

        for item in found:
            job = self._parse_getro_job(item)
            if job:
                jobs.append(job)

        return jobs

    def _get_total_from_next_data(self, data: dict) -> int | None:
        """Get the total job count from __NEXT_DATA__."""
        try:
            return data["props"]["pageProps"]["initialState"]["jobs"].get("total")
        except (KeyError, TypeError):
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
            work_mode = item.get("workMode", "")
            remote = work_mode == "remote" or "remote" in title.lower()
            if not remote and isinstance(locations, list):
                remote = any("remote" in str(l).lower() for l in locations)

            # URL
            job_url = item.get("url", "")

            # Posted date — Getro uses createdAt (unix timestamp)
            created_at = item.get("createdAt")
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
            headcount = org.get("headCount")
            headcount_map = {1: "1-10", 2: "11-50", 3: "51-200", 4: "201-500", 5: "501-1000"}
            company_size = headcount_map.get(headcount, f"{headcount}") if headcount else None
            seniority = item.get("seniority")
            industry_tags = org.get("industryTags", [])
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

    # ── API-based fetching (may require auth — fallback gracefully) ─────

    async def _fetch_via_api(self) -> list[Job]:
        """Try to fetch jobs via the Getro REST API. Falls back gracefully."""
        jobs: list[Job] = []
        page = 1
        per_page = 50

        async with httpx.AsyncClient(timeout=30.0) as client:
            while True:
                url = (
                    f"https://api.getro.com/v2/networks/{self._network_id}"
                    f"/jobs?page={page}&per_page={per_page}"
                )

                try:
                    resp = await client.get(
                        url,
                        headers={
                            "Accept": "application/json",
                            "User-Agent": "Mozilla/5.0",
                        },
                    )

                    if resp.status_code == 401:
                        self.logger.debug(
                            "Getro API requires auth for %s — using __NEXT_DATA__ only",
                            self.name,
                        )
                        return []

                    resp.raise_for_status()
                except httpx.HTTPError as e:
                    self.logger.debug("Getro API failed for %s: %s", self.name, e)
                    return []

                data = resp.json()
                items = data.get("items", [])
                if not items:
                    break

                for item in items:
                    job = self._parse_getro_api_job(item)
                    if job:
                        jobs.append(job)

                total = data.get("total_count", 0)
                if page * per_page >= total:
                    break

                page += 1
                await asyncio.sleep(RATE_LIMIT_DELAY)

        return jobs

    def _parse_getro_api_job(self, item: dict) -> Job | None:
        """Parse a job from the Getro v2 API (different schema from __NEXT_DATA__)."""
        try:
            title = item.get("title", "")
            if not title:
                return None

            company = item.get("company", {})
            company_name = company.get("name", "Unknown")

            locations = item.get("locations", [])
            location_str = self._normalize_location(locations)
            remote = self._is_remote(locations, title)

            job_url = item.get("url", "")
            posted_str = item.get("published_at") or item.get("created_at", "")
            try:
                posted_date = datetime.fromisoformat(
                    posted_str.replace("Z", "+00:00")
                )
            except (ValueError, AttributeError):
                posted_date = datetime.now(timezone.utc)

            return Job(
                company=company_name,
                title=title,
                location=location_str,
                url=job_url,
                posted_date=posted_date,
                vc_backers=[self.name],
                category=categorize_role(title),
                remote=remote,
                source_platform="getro",
                hiring_period=classify_hiring_period(title),
                education_level=classify_education_level(title),
            )
        except Exception as e:
            self.logger.debug("Failed to parse Getro API job: %s", e)
            return None
