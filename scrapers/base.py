from __future__ import annotations

import abc
import logging
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone

logger = logging.getLogger(__name__)


@dataclass
class Job:
    company: str
    title: str  # was "role"
    location: str
    url: str
    posted_date: datetime
    vc_backers: list[str] = field(default_factory=list)
    category: str = "Other"  # SWE, Data Science, Quant, PM, Other
    remote: bool = False
    # New enriched fields
    company_slug: str | None = None
    company_size: str | None = None
    company_domain: str | None = None
    hybrid: bool = False
    seniority: str | None = None  # intern, junior, mid, senior, staff, lead
    salary_min: int | None = None  # in cents
    salary_max: int | None = None  # in cents
    salary_currency: str | None = None
    salary_period: str | None = None
    department: str | None = None
    job_type: str | None = None  # Full-time, Intern, Contract
    industry: str | None = None
    skills: list[str] = field(default_factory=list)
    source_platform: str | None = None
    # Hiring period: "Currently Hiring", "2026 Summer", "2026 New Grad", "2027 Summer", "2027 New Grad"
    hiring_period: list[str] = field(default_factory=list)
    # Education level: "Undergraduate", "Graduate", "PhD"
    education_level: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["posted_date"] = self.posted_date.isoformat()
        return d

    @classmethod
    def from_dict(cls, d: dict) -> Job:
        d = dict(d)
        if isinstance(d.get("posted_date"), str):
            d["posted_date"] = datetime.fromisoformat(d["posted_date"])
        # Handle old "role" field name
        if "role" in d and "title" not in d:
            d["title"] = d.pop("role")
        # Drop unknown keys
        valid = {f.name for f in cls.__dataclass_fields__.values()}
        d = {k: v for k, v in d.items() if k in valid}
        return cls(**d)


CATEGORY_KEYWORDS = {
    "SWE": [
        "software", "engineer", "developer", "frontend", "backend",
        "full stack", "fullstack", "full-stack", "sre", "devops",
        "platform engineer", "systems engineer", "mobile engineer",
        "ios", "android", "web engineer",
    ],
    "Data Science": [
        "data scien", "machine learning", "ml engineer", "ai engineer",
        "deep learning", "nlp", "computer vision", "data analyst",
        "analytics engineer", "research scientist",
    ],
    "Quant": [
        "quant", "quantitative", "algorithmic", "trading",
        "portfolio manager", "risk analyst",
    ],
    "PM": [
        "product manager", "program manager", "technical program",
        "product lead", "product owner",
    ],
}


def categorize_role(title: str) -> str:
    title_lower = title.lower()
    for category, keywords in CATEGORY_KEYWORDS.items():
        if any(kw in title_lower for kw in keywords):
            return category


def classify_hiring_period(title: str, seniority: str | None = None, job_type: str | None = None) -> list[str]:
    """Classify a job into hiring periods based on title and metadata."""
    t = title.lower()
    sen = (seniority or "").lower()
    jt = (job_type or "").lower()
    periods = []

    # Explicit year/season in title
    if "2027" in t:
        if "summer" in t or "intern" in t:
            periods.append("2027 Summer")
        elif "new grad" in t or "new graduate" in t:
            periods.append("2027 New Grad")
        elif "spring" in t or "fall" in t or "winter" in t:
            periods.append("2027 Summer")  # close enough
        else:
            periods.append("2027 New Grad")
    if "2026" in t:
        if "summer" in t or "intern" in t:
            periods.append("2026 Summer")
        elif "new grad" in t or "new graduate" in t or "university grad" in t:
            periods.append("2026 New Grad")
        elif "fall" in t or "spring" in t or "winter" in t:
            periods.append("2026 Summer")  # seasonal = intern-like
        else:
            periods.append("2026 New Grad")

    # Infer from seniority/job_type if no explicit year
    if not periods:
        is_intern = "intern" in t or "intern" in sen or "internship" in jt
        is_new_grad = "new grad" in t or "new graduate" in t or "entry level" in t or "associate" in sen
        is_junior = "junior" in sen or sen == "junior"

        if is_intern:
            periods.append("2026 Summer")
        elif is_new_grad:
            periods.append("2026 New Grad")
            periods.append("Currently Hiring")
        elif is_junior:
            periods.append("Currently Hiring")
            periods.append("2026 New Grad")
        else:
            periods.append("Currently Hiring")

    return periods


def classify_education_level(title: str, degrees: list[str] | None = None) -> list[str]:
    """Classify education level from title and degree requirements."""
    t = title.lower()
    levels = []

    if degrees:
        for d in degrees:
            dl = d.lower()
            if "phd" in dl or "doctorate" in dl:
                if "PhD" not in levels:
                    levels.append("PhD")
            elif "master" in dl or "mba" in dl:
                if "Graduate" not in levels:
                    levels.append("Graduate")
            elif "bachelor" in dl or "associate" in dl or "bootcamp" in dl or "certificate" in dl:
                if "Undergraduate" not in levels:
                    levels.append("Undergraduate")

    # Infer from title if no degree info
    if "phd" in t or "ph.d" in t or "doctorate" in t:
        if "PhD" not in levels:
            levels.append("PhD")
    if "mba" in t or "master" in t or "graduate student" in t:
        if "Graduate" not in levels:
            levels.append("Graduate")

    # Default: if nothing found, assume undergraduate
    if not levels:
        levels.append("Undergraduate")

    return levels
    return "Other"


class BaseScraper(abc.ABC):
    def __init__(self, board_config: dict, known_urls: set[str] | None = None):
        self.config = board_config
        self.name = board_config["name"]
        self.url = board_config["url"]
        self.known_urls = known_urls or set()
        self.logger = logging.getLogger(f"{__name__}.{self.__class__.__name__}")

    @abc.abstractmethod
    async def scrape(self) -> list[Job]:
        ...

    def _normalize_location(self, locations: list[dict] | str | None) -> str:
        if not locations:
            return "Unknown"
        if isinstance(locations, str):
            return locations
        parts = []
        for loc in locations:
            city = loc.get("city", "")
            state = loc.get("state", "")
            country = loc.get("country", "")
            if city and state:
                parts.append(f"{city}, {state}")
            elif city and country:
                parts.append(f"{city}, {country}")
            elif city:
                parts.append(city)
            elif state:
                parts.append(state)
            elif country:
                parts.append(country)
        return " / ".join(parts[:3]) if parts else "Unknown"

    def _is_remote(self, locations: list[dict] | str | None, title: str = "") -> bool:
        if "remote" in title.lower():
            return True
        if isinstance(locations, str):
            return "remote" in locations.lower()
        if isinstance(locations, list):
            for loc in locations:
                for v in loc.values():
                    if isinstance(v, str) and "remote" in v.lower():
                        return True
        return False
