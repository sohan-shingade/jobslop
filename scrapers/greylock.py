"""Greylock's portfolio job board: job data is embedded in each page's Next.js payload."""

from __future__ import annotations

import asyncio
import json
import re
from datetime import datetime

import httpx

from .base import BaseScraper, Job, categorize_role, classify_education_level, classify_hiring_period

RATE_LIMIT_DELAY = 1.0
MAX_PAGES = 200
PAYLOAD = re.compile(r'self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)')


def page_jobs(page_html: str) -> list[dict]:
    payload = "".join(json.loads(f'"{chunk}"') for chunk in PAYLOAD.findall(page_html))
    decoder = json.JSONDecoder()
    lists = [decoder.raw_decode(payload, m.end() - 1)[0] for m in re.finditer(r'"jobs":\[', payload)]
    # Later pages also embed page 1's list first.
    return lists[-1] if lists else []


class GreylockScraper(BaseScraper):
    async def scrape(self) -> list[Job]:
        jobs: dict[str, Job] = {}
        seen_ids: set[str] = set()
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
            for page in range(1, MAX_PAGES + 1):
                try:
                    resp = await client.get(
                        self.url, params={"page": page}, headers={"User-Agent": "Mozilla/5.0"}
                    )
                    resp.raise_for_status()
                except httpx.HTTPError as e:
                    self.logger.error("Failed to fetch Greylock page %d: %s", page, e)
                    break
                items = page_jobs(resp.text)
                if not items or {i["id"] for i in items} <= seen_ids:
                    break
                seen_ids.update(i["id"] for i in items)
                for job in map(self._parse, items):
                    if job.url not in self.known_urls:
                        jobs[job.url] = job
                await asyncio.sleep(RATE_LIMIT_DELAY)
        self.logger.info("Fetched %d jobs from Greylock", len(jobs))
        return list(jobs.values())

    def _parse(self, item: dict) -> Job:
        title = item["title"]
        locations = item.get("normalizedLocations") or item.get("locations") or []
        salary = item.get("salary") or {}
        seniorities = item.get("seniorities") or []
        functions = item.get("functions") or []
        work_mode = item.get("workMode")
        return Job(
            company=item["companyName"],
            title=title,
            location=" / ".join(locations[:3]) or "Unknown",
            url=item["applyUrl"].split("?")[0],
            posted_date=datetime.fromisoformat(item["createdAt"].replace("Z", "+00:00")),
            vc_backers=[self.name],
            category=categorize_role(title),
            remote=work_mode == "remote",
            hybrid=work_mode == "hybrid",
            company_domain=item.get("companyDomain"),
            salary_min=salary.get("min"),
            salary_max=salary.get("max"),
            salary_currency=salary.get("currency"),
            salary_period=salary.get("period", "").lower() or None,
            department=functions[0] if functions else None,
            seniority=seniorities[0].lower() if seniorities else None,
            skills=item.get("skills") or [],
            source_platform="greylock",
            hiring_period=classify_hiring_period(title),
            education_level=classify_education_level(title),
        )
