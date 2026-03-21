# Jobslop: Database + Website Refactor

**Date:** 2026-03-21
**Status:** Approved

## Overview

Refactor jobslop from a Python scraper that outputs a README table into a full web application with a database backend, search, filtering, and sorting across 11K+ VC-backed startup job listings.

## Architecture

Two-part system:

1. **Scrapers (Python, existing)** — run on a schedule, write to Turso DB instead of `data/jobs.json`
2. **Web app (Next.js)** — reads from Turso, serves the job board UI. Deployed on Vercel.

```
[Python Scrapers] --write--> [Turso SQLite DB] <--read-- [Next.js on Vercel]
     (cron)                   (hosted, free tier)          (SSR + client search)
```

Turso is used instead of bundled SQLite because Vercel's serverless functions have no persistent filesystem. Turso is hosted libsql with a generous free tier (500 DBs, 9GB storage).

Scrapers use `libsql-client` (Python) to INSERT jobs directly into Turso. The Next.js app queries Turso on each request via server components. No JSON files, no build-time data loading.

## Database Schema

### `jobs` table

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | Hash of url |
| title | TEXT NOT NULL | Job title |
| company | TEXT NOT NULL | Company name |
| company_slug | TEXT | For grouping |
| company_size | TEXT | e.g. "1000+ employees" |
| company_domain | TEXT | e.g. "stripe.com" |
| location | TEXT | Display string |
| remote | BOOLEAN | |
| hybrid | BOOLEAN | |
| url | TEXT NOT NULL UNIQUE | Apply URL |
| posted_date | DATETIME | |
| seniority | TEXT | intern, junior, mid, senior, staff, lead |
| salary_min | INTEGER | In cents |
| salary_max | INTEGER | In cents |
| salary_currency | TEXT | e.g. "USD" |
| salary_period | TEXT | e.g. "year" |
| department | TEXT | Engineering, Sales, etc. |
| job_type | TEXT | Full-time, Intern, Contract |
| industry | TEXT | Healthcare, Fintech, AI, etc. |
| skills | TEXT | JSON array |
| category | TEXT | SWE, Data Science, Quant, PM, Other |
| source_platform | TEXT | consider, getro |
| created_at | DATETIME | Default CURRENT_TIMESTAMP |
| updated_at | DATETIME | Default CURRENT_TIMESTAMP |

### `job_vc_backers` table (many-to-many)

| Column | Type | Notes |
|--------|------|-------|
| job_id | TEXT | FK → jobs.id |
| vc_name | TEXT | |
| | | PK (job_id, vc_name) |

### `vc_boards` table (reference)

| Column | Type | Notes |
|--------|------|-------|
| name | TEXT PK | |
| platform | TEXT | consider, getro |
| url | TEXT | |
| board_slug | TEXT | For Consider boards |
| network_id | INTEGER | For Getro boards |
| last_scraped | DATETIME | |
| enabled | BOOLEAN | Default TRUE |

### Key decisions

- Job `id` is a hash of the URL — natural dedup key
- Salary stored in cents to avoid float issues
- Skills as JSON array in TEXT column — queryable with `json_each()` in SQLite
- VC backers in a separate table for the many-to-many relationship
- Indexes on: `company`, `seniority`, `remote`, `posted_date`, `department`, `category`

## Web App

### Single page: `/`

Top filter bar + dense table rows layout.

### Filter bar

Dropdowns with multi-select checkboxes for:
- Location
- Seniority (intern, junior, mid, senior, staff, lead)
- Remote toggle
- Department (Engineering, Sales, Marketing, etc.)
- Industry (Healthcare, Fintech, AI, etc.)
- VC Backer (Sequoia, a16z, etc.)
- Company Size

Plus a keyword search bar (debounced full-text search on title + company).

### Table

Sortable columns: Role, Company, Location, Level, Salary, Age.

Each row shows:
- Company initial avatar (colored)
- Job title
- Company name
- Location (with remote indicator)
- Seniority badge
- Salary range (when available)
- Age (human-readable: 1d, 3d, 1w)

Clicking a row opens the apply URL in a new tab.

### Interactions

- **Column headers** — clickable to sort (toggle asc/desc)
- **Active filters** — shown as dismissible chips
- **URL state** — all filters/sort/search synced to URL params (e.g. `?q=ml&seniority=senior&remote=true&sort=salary_desc`). Shareable, bookmarkable.
- **Pagination** — "Load more" button (not infinite scroll)

### Tech stack

- Next.js App Router with Server Components
- Tailwind CSS
- `@libsql/client` for Turso queries
- URL params as state (no client state libraries)

## Scraper Refactor

Minimal changes to existing scraping logic:

1. **Expand `Job` dataclass** — add salary, seniority, skills, company_size, department, industry, hybrid fields. Consider parser already has access to all of this data.
2. **Replace JSON output with Turso upserts** — `aggregate.py` upserts rows using `ON CONFLICT(url)` for DB-level dedup.
3. **Incremental logic stays** — known-URL set comes from `SELECT url FROM jobs` instead of reading `jobs.json`.
4. **Keep `generate_readme.py`** as optional — can query DB and write README for the GitHub repo.

New Python dependency: `libsql-client`.

## Deployment

1. **Turso** — `turso db create jobslop`. Get URL + auth token.
2. **Vercel** — Deploy Next.js via `vercel` CLI. Set `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` env vars.
3. **Scrapers** — Run locally or via GitHub Actions with same env vars.

No rebuild needed when scrapers run — Vercel app queries Turso at request time. New jobs appear immediately.

### Environment variables

- `TURSO_DATABASE_URL` — e.g. `libsql://jobslop-yourname.turso.io`
- `TURSO_AUTH_TOKEN` — from `turso db tokens create jobslop`
