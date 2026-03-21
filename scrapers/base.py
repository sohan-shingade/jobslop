from __future__ import annotations

import abc
import logging
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone

logger = logging.getLogger(__name__)


@dataclass
class Job:
    company: str
    role: str
    location: str
    url: str
    posted_date: datetime
    vc_backers: list[str] = field(default_factory=list)
    category: str = "Other"  # SWE, Data Science, Quant, PM, Other
    remote: bool = False

    def to_dict(self) -> dict:
        d = asdict(self)
        d["posted_date"] = self.posted_date.isoformat()
        return d

    @classmethod
    def from_dict(cls, d: dict) -> Job:
        d = dict(d)
        if isinstance(d["posted_date"], str):
            d["posted_date"] = datetime.fromisoformat(d["posted_date"])
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
