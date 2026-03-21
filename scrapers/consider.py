"""Consider-powered VC job board scraper.

Covers boards like Sequoia, Greylock, a16z, BVP, Kleiner Perkins, etc.
These boards use Consider's API at POST /api-boards/search-jobs with
cursor-based pagination. No authentication required.
"""

from __future__ import annotations

import asyncio
import logging
import re
from datetime import datetime, timezone

import httpx

from .base import BaseScraper, Job, categorize_role

logger = logging.getLogger(__name__)

PAGE_SIZE = 50
RATE_LIMIT_DELAY = 0.5  # seconds between paginated requests
MAX_PAGES = 200  # safety limit
DEFAULT_MAX_JOBS_FULL = 2000  # cap per board for full scrapes
DEFAULT_MAX_JOBS_INCREMENTAL = 500  # cap for incremental runs (new jobs rank high)
KNOWN_PAGE_RATIO = 0.8  # stop if >80% of a page are known jobs
KNOWN_PAGES_TO_STOP = 2  # stop after this many high-known-ratio pages in a row


class ConsiderScraper(BaseScraper):
    """Scrapes Consider-powered VC job boards via their POST API."""

    def __init__(self, board_config: dict, known_urls: set[str] | None = None):
        super().__init__(board_config, known_urls)
        self._slug: str | None = board_config.get("board_slug")
        incremental = bool(known_urls)
        default_cap = DEFAULT_MAX_JOBS_INCREMENTAL if incremental else DEFAULT_MAX_JOBS_FULL
        self._max_jobs: int = board_config.get("max_jobs", default_cap)

    async def scrape(self) -> list[Job]:
        # Discover the board slug if not configured
        if not self._slug:
            self._slug = await self._discover_slug()
            if not self._slug:
                self.logger.error("Could not discover board slug for %s", self.name)
                return []
            self.logger.info("Discovered slug '%s' for %s", self._slug, self.name)

        return await self._fetch_all_jobs()

    async def _discover_slug(self) -> str | None:
        """Fetch the board page and extract the fixedBoard slug from HTML."""
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

            match = re.search(r'"fixedBoard"\s*:\s*"([^"]+)"', resp.text)
            return match.group(1) if match else None

    async def _fetch_all_jobs(self) -> list[Job]:
        """Paginate through the Consider search-jobs API.

        In incremental mode (known_urls is non-empty), stops paginating
        once consecutive pages are dominated by already-seen job URLs.
        The API sorts by relevance (not date), so known/unknown jobs are
        interleaved — we check the known-URL ratio per page instead of
        tracking consecutive matches.
        """
        jobs: list[Job] = []
        sequence: str | None = None
        high_known_pages = 0
        base_url = self.url.rstrip("/")
        origin = re.match(r"(https?://[^/]+)", base_url).group(1)
        api_url = f"{origin}/api-boards/search-jobs"
        incremental = len(self.known_urls) > 0

        async with httpx.AsyncClient(timeout=30.0) as client:
            for page_num in range(MAX_PAGES):
                body = {
                    "meta": {"size": PAGE_SIZE},
                    "board": {"id": self._slug, "isParent": True},
                    "query": {},
                    "grouped": False,
                }
                if sequence:
                    body["meta"]["sequence"] = sequence

                try:
                    resp = await client.post(
                        api_url,
                        json=body,
                        headers={
                            "Content-Type": "application/json",
                            "User-Agent": "Mozilla/5.0",
                            "Origin": origin,
                            "Referer": f"{origin}/jobs",
                        },
                    )
                    resp.raise_for_status()
                except httpx.HTTPStatusError as e:
                    self.logger.error(
                        "API error for %s page %d: %s", self.name, page_num, e
                    )
                    break
                except httpx.RequestError as e:
                    self.logger.error(
                        "Request failed for %s page %d: %s", self.name, page_num, e
                    )
                    break

                data = resp.json()
                if data.get("errors"):
                    self.logger.error(
                        "API errors for %s: %s", self.name, data["errors"]
                    )
                    break

                items = data.get("jobs", [])
                if not items:
                    break

                page_known = 0
                page_new = 0
                for item in items:
                    job = self._parse_job(item)
                    if job:
                        if incremental and job.url in self.known_urls:
                            page_known += 1
                        else:
                            page_new += 1
                            jobs.append(job)

                # Check if this page was mostly known jobs
                if incremental and (page_known + page_new) > 0:
                    ratio = page_known / (page_known + page_new)
                    if ratio >= KNOWN_PAGE_RATIO:
                        high_known_pages += 1
                    else:
                        high_known_pages = 0

                    if high_known_pages >= KNOWN_PAGES_TO_STOP:
                        self.logger.info(
                            "%s: %d consecutive pages with >%d%% known jobs, "
                            "stopping incremental fetch (%d new jobs found)",
                            self.name, KNOWN_PAGES_TO_STOP,
                            int(KNOWN_PAGE_RATIO * 100), len(jobs),
                        )
                        break

                # Cursor-based pagination
                meta = data.get("meta", {})
                sequence = meta.get("sequence")
                if not sequence:
                    break

                total = data.get("total", 0)
                if len(jobs) >= total:
                    break

                if len(jobs) >= self._max_jobs:
                    self.logger.info(
                        "%s: hit max_jobs cap (%d), stopping",
                        self.name, self._max_jobs,
                    )
                    break

                if page_num > 0 and page_num % 10 == 0:
                    self.logger.info(
                        "%s: fetched %d new / %d total so far...",
                        self.name, len(jobs), total,
                    )

                await asyncio.sleep(RATE_LIMIT_DELAY)

        self.logger.info(
            "Fetched %d new jobs from %s%s",
            len(jobs), self.name,
            " (incremental)" if incremental else "",
        )
        return jobs

    def _parse_job(self, item: dict) -> Job | None:
        """Convert a Consider API job item into a Job dataclass."""
        try:
            title = item.get("title", "")
            if not title:
                return None

            company_name = item.get("companyName", "Unknown")

            # Locations
            locations = item.get("locations", [])
            if isinstance(locations, list):
                location_str = " / ".join(locations[:3]) if locations else "Unknown"
            else:
                location_str = str(locations) if locations else "Unknown"

            remote = bool(item.get("remote", False))
            hybrid = bool(item.get("hybrid", False))
            if not remote:
                remote = self._is_remote(location_str, title)

            job_url = item.get("applyUrl") or item.get("url", "")

            # Posted date
            timestamp = item.get("timeStamp", "")
            try:
                posted_date = datetime.fromisoformat(
                    timestamp.replace("Z", "+00:00")
                )
            except (ValueError, AttributeError):
                posted_date = datetime.now(timezone.utc)

            # Seniority
            seniority_list = item.get("jobSeniorities", [])
            seniority = seniority_list[0].get("label") if seniority_list else None

            # Salary (convert to cents)
            salary_data = item.get("salary") or {}
            salary_min = None
            salary_max = None
            salary_currency = None
            salary_period = None
            if salary_data:
                raw_min = salary_data.get("minValue")
                raw_max = salary_data.get("maxValue")
                if raw_min is not None:
                    salary_min = int(raw_min * 100)
                if raw_max is not None:
                    salary_max = int(raw_max * 100)
                currency_obj = salary_data.get("currency") or {}
                salary_currency = currency_obj.get("value") if isinstance(currency_obj, dict) else str(currency_obj) if currency_obj else None
                period_obj = salary_data.get("period") or {}
                salary_period = period_obj.get("value") if isinstance(period_obj, dict) else str(period_obj) if period_obj else None

            # Department
            departments = item.get("departments", [])
            department = departments[0] if departments else None

            # Job type
            job_types = item.get("jobTypes", [])
            job_type = job_types[0].get("label") if job_types else None

            # Industry / market
            markets = item.get("markets", [])
            industry = markets[0].get("label") if markets else None

            # Skills
            skills_raw = item.get("skills", []) + item.get("requiredSkills", []) + item.get("preferredSkills", [])
            skills = list({s.get("label") or s for s in skills_raw if s} )

            # Company metadata
            company_slug = item.get("companySlug")
            company_domain = item.get("companyDomain")
            staff_count = item.get("companyStaffCount")
            stages = item.get("stages", [])
            company_size = stages[0].get("label") if stages else (
                f"{staff_count} employees" if staff_count else None
            )

            return Job(
                company=company_name,
                title=title,
                location=location_str,
                url=job_url,
                posted_date=posted_date,
                vc_backers=[self.name],
                category=categorize_role(title),
                remote=remote,
                company_slug=company_slug,
                company_size=company_size,
                company_domain=company_domain,
                hybrid=hybrid,
                seniority=seniority,
                salary_min=salary_min,
                salary_max=salary_max,
                salary_currency=salary_currency,
                salary_period=salary_period,
                department=department,
                job_type=job_type,
                industry=industry,
                skills=skills,
                source_platform="consider",
            )
        except Exception as e:
            self.logger.debug("Failed to parse Consider job: %s", e)
            return None
