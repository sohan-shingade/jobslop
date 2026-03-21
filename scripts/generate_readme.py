"""Converts data/jobs.json into a Simplify-style README.md table.

Usage:
    python scripts/generate_readme.py
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

JOBS_FILE = ROOT / "data" / "jobs.json"
README_FILE = ROOT / "README.md"

CATEGORY_ORDER = ["SWE", "Data Science", "Quant", "PM", "Other"]
CATEGORY_LABELS = {
    "SWE": "Software Engineering",
    "Data Science": "Data Science & Machine Learning",
    "Quant": "Quantitative Finance",
    "PM": "Product Management",
    "Other": "Other Roles",
}
CATEGORY_EMOJI = {
    "SWE": "💻",
    "Data Science": "📊",
    "Quant": "📈",
    "PM": "📋",
    "Other": "🔧",
}


def _human_age(posted: datetime) -> str:
    """Convert a posted date into a human-readable age string."""
    now = datetime.now(timezone.utc)
    if posted.tzinfo is None:
        posted = posted.replace(tzinfo=timezone.utc)
    delta = now - posted
    days = delta.days

    if days < 0:
        return "new"
    if days == 0:
        return "today"
    if days == 1:
        return "1d"
    if days < 7:
        return f"{days}d"
    if days < 14:
        return "1w"
    if days < 30:
        return f"{days // 7}w"
    if days < 60:
        return "1mo"
    return f"{days // 30}mo"


def _escape_md(text: str) -> str:
    """Escape pipe characters for markdown table cells."""
    return text.replace("|", "\\|").replace("\n", " ").strip()


def _truncate(text: str, max_len: int = 60) -> str:
    if len(text) <= max_len:
        return text
    return text[: max_len - 1] + "…"


def generate() -> None:
    if not JOBS_FILE.exists():
        print(f"No jobs file found at {JOBS_FILE} — run aggregate.py first.")
        return

    jobs = json.loads(JOBS_FILE.read_text())
    print(f"Loaded {len(jobs)} jobs")

    # Group by category
    grouped: dict[str, list[dict]] = {cat: [] for cat in CATEGORY_ORDER}
    for job in jobs:
        cat = job.get("category", "Other")
        if cat not in grouped:
            cat = "Other"
        grouped[cat].append(job)

    # Build README
    lines: list[str] = []
    lines.append("# VC-Backed Startup Job Board")
    lines.append("")
    lines.append(
        "Automatically aggregated from 50+ venture capital portfolio job boards. "
        "Updated daily via GitHub Actions."
    )
    lines.append("")

    # Jump links
    total = len(jobs)
    lines.append(f"**{total:,} open positions** across {_count_companies(jobs)} companies")
    lines.append("")
    lines.append("### Jump to section")
    for cat in CATEGORY_ORDER:
        count = len(grouped[cat])
        if count > 0:
            emoji = CATEGORY_EMOJI[cat]
            label = CATEGORY_LABELS[cat]
            anchor = label.lower().replace(" ", "-").replace("&", "").replace("  ", "-")
            lines.append(f"- [{emoji} {label} ({count})](#{anchor})")
    lines.append("")
    lines.append("---")
    lines.append("")

    # Tables per category
    for cat in CATEGORY_ORDER:
        cat_jobs = grouped[cat]
        if not cat_jobs:
            continue

        emoji = CATEGORY_EMOJI[cat]
        label = CATEGORY_LABELS[cat]
        lines.append(f"## {emoji} {label}")
        lines.append("")
        lines.append("| Company | Role | Location | VC Backer(s) | Link | Age |")
        lines.append("| ------- | ---- | -------- | ------------ | ---- | --- |")

        for job in cat_jobs:
            company = _escape_md(job["company"])
            role = _escape_md(_truncate(job.get("title", job.get("role", ""))))
            location = _escape_md(_truncate(job["location"], 40))
            backers = ", ".join(job.get("vc_backers", []))
            backers = _escape_md(_truncate(backers, 50))
            url = job.get("url", "")
            link = f"[Apply]({url})" if url else "—"

            posted_str = job.get("posted_date", "")
            try:
                posted = datetime.fromisoformat(posted_str)
                age = _human_age(posted)
            except (ValueError, TypeError):
                age = "?"

            lines.append(
                f"| **{company}** | {role} | {location} | {backers} | {link} | {age} |"
            )

        lines.append("")

    # Footer
    lines.append("---")
    lines.append("")
    lines.append(
        "*This board is auto-generated. "
        "Data sourced from Getro, Greenhouse, Lever, and custom scrapers. "
        "See [CONTRIBUTING.md](CONTRIBUTING.md) to add a board.*"
    )
    lines.append("")

    README_FILE.write_text("\n".join(lines))
    print(f"Wrote README.md with {total} jobs")


def _count_companies(jobs: list[dict]) -> int:
    return len({j["company"] for j in jobs})


if __name__ == "__main__":
    generate()
