"""Deduplication engine for job listings.

Two-pass approach:
1. Exact-match pass: group by (normalized_company, normalized_title, city_key)
   — O(n), handles the vast majority of dupes.
2. Fuzzy pass within each company bucket: rapidfuzz on (title, location)
   — only compares jobs from the same company, so much smaller N.

When duplicates are found, vc_backer lists are merged.
"""

from __future__ import annotations

import logging
import re
import unicodedata
from collections import defaultdict

from rapidfuzz import fuzz

from scrapers.base import Job

logger = logging.getLogger(__name__)

FUZZY_THRESHOLD = 85


def _normalize(text: str) -> str:
    """Lowercase, strip accents, collapse whitespace, remove punctuation."""
    text = unicodedata.normalize("NFKD", text)
    text = text.encode("ascii", "ignore").decode()
    text = text.lower().strip()
    text = re.sub(r"[^\w\s]", "", text)
    text = re.sub(r"\s+", " ", text)
    return text


def _company_key(company: str) -> str:
    """Normalize company name for bucketing."""
    key = _normalize(company)
    # Remove common suffixes
    for suffix in ["inc", "llc", "ltd", "corp", "co", "company"]:
        key = re.sub(rf"\b{suffix}\b", "", key).strip()
    return key


def _exact_key(job: Job) -> str:
    """Deterministic key for exact-match dedup."""
    company = _company_key(job.company)
    title = _normalize(job.title)
    city = _normalize(job.location.split("/")[0].split(",")[0])
    return f"{company}||{title}||{city}"


def _merge_jobs(existing: Job, duplicate: Job) -> Job:
    """Merge a duplicate into the existing job, combining vc_backers."""
    merged_backers = list(existing.vc_backers)
    for backer in duplicate.vc_backers:
        if backer not in merged_backers:
            merged_backers.append(backer)

    posted = min(existing.posted_date, duplicate.posted_date)
    url = existing.url if len(existing.url) >= len(duplicate.url) else duplicate.url

    # Prefer the record with richer data for enriched fields
    pick = existing if existing.seniority else duplicate

    return Job(
        company=existing.company,
        title=existing.title,
        location=existing.location,
        url=url,
        posted_date=posted,
        vc_backers=merged_backers,
        category=existing.category,
        remote=existing.remote or duplicate.remote,
        company_slug=existing.company_slug or duplicate.company_slug,
        company_size=existing.company_size or duplicate.company_size,
        company_domain=existing.company_domain or duplicate.company_domain,
        hybrid=existing.hybrid or duplicate.hybrid,
        seniority=pick.seniority,
        salary_min=existing.salary_min or duplicate.salary_min,
        salary_max=existing.salary_max or duplicate.salary_max,
        salary_currency=existing.salary_currency or duplicate.salary_currency,
        salary_period=existing.salary_period or duplicate.salary_period,
        department=existing.department or duplicate.department,
        job_type=existing.job_type or duplicate.job_type,
        industry=existing.industry or duplicate.industry,
        skills=existing.skills or duplicate.skills,
        source_platform=existing.source_platform or duplicate.source_platform,
        hiring_period=list(set(existing.hiring_period + duplicate.hiring_period)),
        education_level=list(set(existing.education_level + duplicate.education_level)),
    )


def deduplicate(jobs: list[Job]) -> list[Job]:
    """Remove duplicate job listings, merging vc_backer lists."""
    if not jobs:
        return []

    # Pass 1: exact-match grouping — O(n)
    groups: dict[str, Job] = {}
    for job in jobs:
        key = _exact_key(job)
        if key in groups:
            groups[key] = _merge_jobs(groups[key], job)
        else:
            groups[key] = job

    after_exact = list(groups.values())
    exact_removed = len(jobs) - len(after_exact)

    # Pass 2: fuzzy dedup within company buckets
    company_buckets: dict[str, list[Job]] = defaultdict(list)
    for job in after_exact:
        company_buckets[_company_key(job.company)].append(job)

    unique: list[Job] = []
    fuzzy_removed = 0

    for _company, bucket in company_buckets.items():
        if len(bucket) == 1:
            unique.append(bucket[0])
            continue

        # Within-bucket fuzzy dedup (small N per bucket)
        merged: list[Job] = []
        for job in bucket:
            found_dup = False
            for i, existing in enumerate(merged):
                title_score = fuzz.token_sort_ratio(
                    _normalize(existing.title), _normalize(job.title)
                )
                if title_score >= FUZZY_THRESHOLD:
                    merged[i] = _merge_jobs(existing, job)
                    found_dup = True
                    fuzzy_removed += 1
                    break
            if not found_dup:
                merged.append(job)
        unique.extend(merged)

    total_removed = exact_removed + fuzzy_removed
    if total_removed:
        logger.info(
            "Deduplication: %d → %d jobs (%d exact + %d fuzzy dupes removed)",
            len(jobs), len(unique), exact_removed, fuzzy_removed,
        )

    return unique
