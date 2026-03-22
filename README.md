# jobslop

Job board aggregator for VC-backed startups. Pulls listings from 35+ venture capital portfolio boards, SimplifyJobs, and Levels.fyi into one searchable interface with filters, sorting, and AI-powered resume matching.

**Live at [jobslop.vercel.app](https://jobslop.vercel.app)**

## What it does

- **12,800+ jobs** from Sequoia, a16z, Greylock, Kleiner Perkins, and 30+ other top VC portfolio boards
- **Internships & new grad** positions from SimplifyJobs (8,000+ active listings)
- **Search** by keyword, filter by seniority, location, industry, department, VC backer, remote, and recency
- **Resume matching** — upload a PDF resume, describe what you're looking for, and get jobs ranked by fit
- **Salary data** where available (74% of Consider-sourced jobs)
- Updated daily via GitHub Actions

## How it works

```
Python scrapers → Turso DB (hosted SQLite) ← Next.js on Vercel
    (cron)              ↑                       (SSR)
                   12,800+ jobs
```

**Scrapers** pull from:
- **Consider** (12 boards) — Sequoia, a16z, Greylock, BVP, Kleiner Perkins, etc. Full pagination via POST API.
- **Getro** (23 boards) — General Catalyst, Accel, Insight Partners, etc. Parses `__NEXT_DATA__` from Next.js pages.
- **SimplifyJobs** — Summer 2026 internships + new grad positions. Structured JSON from GitHub.
- **Levels.fyi** — Internship compensation data.

**Resume matching** uses Groq (Llama 3.3 70B, free tier) to extract a structured profile from your resume + intent, then scores jobs by title match, skill overlap, seniority fit, and industry relevance.

## Running locally

### Scrapers

```bash
pip install -r requirements.txt

# Run all scrapers (incremental — only fetches new jobs)
python scripts/aggregate.py

# Full re-scrape
python scripts/aggregate.py --full

# Only specific platform
python scripts/aggregate.py --platforms consider
python scripts/aggregate.py --platforms simplify
```

Requires a `.env` file with:
```
TURSO_DATABASE_URL=libsql://your-db.turso.io
TURSO_AUTH_TOKEN=your-token
```

### Web app

```bash
cd web
npm install
npm run dev
```

Requires `web/.env.local` with:
```
TURSO_DATABASE_URL=libsql://your-db.turso.io
TURSO_AUTH_TOKEN=your-token
GROQ_API_KEY=your-groq-key
```

## Tech stack

- **Scrapers**: Python, httpx, asyncio
- **Database**: Turso (hosted libsql/SQLite)
- **Web**: Next.js 16, Tailwind CSS, TypeScript
- **Resume AI**: Groq (Llama 3.3 70B)
- **Hosting**: Vercel
- **CI**: GitHub Actions (cron 2x/day)
