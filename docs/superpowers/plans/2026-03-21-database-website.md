# Jobslop Database + Website Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor jobslop from a Python scraper outputting JSON/README into a full Next.js web app with Turso (hosted SQLite) backend, search, filtering, and sorting across 11K+ VC-backed startup job listings.

**Architecture:** Python scrapers upsert enriched job data into Turso DB. Next.js App Router app on Vercel queries Turso via server components, rendering a dense sortable table with a top filter bar. URL params drive all state.

**Tech Stack:** Next.js 14 (App Router), Tailwind CSS, @libsql/client (Turso), libsql-experimental (Python), Vercel CLI

**Spec:** `docs/superpowers/specs/2026-03-21-database-website-design.md`

---

## File Structure

### New files (Next.js app)

```
web/
├── package.json
├── next.config.js
├── tailwind.config.js
├── postcss.config.js
├── tsconfig.json
├── .env.local              # TURSO_DATABASE_URL, TURSO_AUTH_TOKEN
├── app/
│   ├── layout.tsx          # Root layout: html, body, font, metadata
│   ├── page.tsx            # Main page: server component, queries DB
│   ├── globals.css         # Tailwind imports + custom styles
│   └── components/
│       ├── FilterBar.tsx    # Top filter bar with dropdowns + search
│       ├── JobTable.tsx     # Dense sortable table rows
│       ├── JobRow.tsx       # Single job row with avatar, badges
│       ├── FilterDropdown.tsx # Reusable multi-select dropdown
│       └── Pagination.tsx   # Load more button + count
├── lib/
│   ├── db.ts               # Turso client singleton
│   ├── queries.ts           # SQL query builders for jobs
│   └── types.ts             # TypeScript types for Job, filters
└── public/
    └── favicon.ico
```

### New files (database)

```
db/
├── schema.sql              # CREATE TABLE statements
└── migrate.py              # Script to create tables + migrate JSON data
```

### Modified files (scrapers)

```
scrapers/base.py            # Expand Job dataclass with new fields
scrapers/consider.py        # Extract salary, seniority, skills, etc. from API
scrapers/getro.py           # Extract additional fields from __NEXT_DATA__
scripts/aggregate.py        # Replace JSON output with Turso upserts
requirements.txt            # Add libsql-experimental
pyproject.toml              # Add libsql-experimental
.gitignore                  # Add .env, .env.local
```

---

## Task 1: Set up Turso database and schema

**Files:**
- Create: `db/schema.sql`
- Create: `db/migrate.py`

- [ ] **Step 1: Install Turso CLI and create database**

```bash
# If turso CLI not installed:
curl -sSfL https://get.tur.so/install.sh | bash

turso db create jobslop
turso db show jobslop --url
turso db tokens create jobslop
```

Save the URL and token. Create `.env` at project root:
```
TURSO_DATABASE_URL=libsql://jobslop-<user>.turso.io
TURSO_AUTH_TOKEN=<token>
```

Add `.env` and `.env.local` to `.gitignore` to avoid committing credentials.

- [ ] **Step 2: Write the schema file**

Create `db/schema.sql`:
```sql
CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    company TEXT NOT NULL,
    company_slug TEXT,
    company_size TEXT,
    company_domain TEXT,
    location TEXT,
    remote INTEGER DEFAULT 0,
    hybrid INTEGER DEFAULT 0,
    url TEXT NOT NULL UNIQUE,
    posted_date TEXT,
    seniority TEXT,
    salary_min INTEGER,
    salary_max INTEGER,
    salary_currency TEXT,
    salary_period TEXT,
    department TEXT,
    job_type TEXT,
    industry TEXT,
    skills TEXT,
    category TEXT,
    source_platform TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS job_vc_backers (
    job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    vc_name TEXT NOT NULL,
    PRIMARY KEY (job_id, vc_name)
);

CREATE TABLE IF NOT EXISTS vc_boards (
    name TEXT PRIMARY KEY,
    platform TEXT NOT NULL,
    url TEXT NOT NULL,
    board_slug TEXT,
    network_id INTEGER,
    last_scraped TEXT,
    enabled INTEGER DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_jobs_company ON jobs(company);
CREATE INDEX IF NOT EXISTS idx_jobs_seniority ON jobs(seniority);
CREATE INDEX IF NOT EXISTS idx_jobs_remote ON jobs(remote);
CREATE INDEX IF NOT EXISTS idx_jobs_posted_date ON jobs(posted_date);
CREATE INDEX IF NOT EXISTS idx_jobs_department ON jobs(department);
CREATE INDEX IF NOT EXISTS idx_jobs_category ON jobs(category);
CREATE INDEX IF NOT EXISTS idx_jobs_location ON jobs(location);
CREATE INDEX IF NOT EXISTS idx_jobs_industry ON jobs(industry);
CREATE INDEX IF NOT EXISTS idx_job_vc_backers_vc ON job_vc_backers(vc_name);
```

- [ ] **Step 3: Write the migration script**

Create `db/migrate.py` that:
1. Reads `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` from env or `.env` file
2. Connects to Turso via `libsql_experimental`
3. Executes `schema.sql` to create tables
4. Optionally loads existing `data/jobs.json` into the DB for initial migration

- [ ] **Step 4: Add libsql-experimental to requirements**

Add `libsql-experimental>=0.0.68` to `requirements.txt` and `pyproject.toml`.

- [ ] **Step 5: Run the migration**

```bash
pip install libsql-experimental python-dotenv
python db/migrate.py
```

Verify tables exist:
```bash
turso db shell jobslop "SELECT name FROM sqlite_master WHERE type='table';"
```

- [ ] **Step 6: Commit**

```bash
git add db/ requirements.txt pyproject.toml .gitignore
git commit -m "feat: add Turso database schema and migration script"
```

---

## Task 2: Expand Job dataclass and Consider parser

**Files:**
- Modify: `scrapers/base.py` (lines 11-32, Job dataclass)
- Modify: `scrapers/consider.py` (lines 191-235, `_parse_job`)

- [ ] **Step 1: Expand the Job dataclass**

In `scrapers/base.py`, replace the Job dataclass with expanded version:
- **Rename `role` → `title`** to match the DB schema (update all references across scrapers/scripts)
- Add new fields: `company_slug`, `company_size`, `company_domain`, `hybrid`, `seniority`, `salary_min`, `salary_max`, `salary_currency`, `salary_period`, `department`, `job_type`, `industry`, `skills`, `source_platform`. All new fields default to `None` or empty.
- Update `to_dict()` and `from_dict()` accordingly.
- Update `categorize_role()` calls to use `title` field name.
- Update `generate_readme.py` references from `role` to `title`.

- [ ] **Step 2: Update Consider parser to extract all fields**

In `scrapers/consider.py`, update `_parse_job()` to extract from the Consider API response:
- `item.get("companySlug")` → `company_slug`
- `item.get("companyStaffCount")` or `item.get("stages", [{}])[0].get("label")` → `company_size`
- `item.get("companyDomain")` → `company_domain`
- `item.get("hybrid", False)` → `hybrid`
- `item.get("jobSeniorities", [{}])[0].get("label")` → `seniority`
- `item.get("salary", {})` → `salary_min`, `salary_max` (convert to cents: multiply by 100), `salary_currency`, `salary_period`
- `item.get("departments", [{}])[0]` → `department`
- `item.get("jobTypes", [{}])[0].get("label")` → `job_type`
- `item.get("markets", [{}])[0].get("label")` → `industry`
- `[s.get("label") for s in item.get("skills", [])]` → `skills`
- Set `source_platform="consider"`

- [ ] **Step 3: Update Getro parser to extract available fields**

In `scrapers/getro.py`, update `_parse_getro_job()` to extract from __NEXT_DATA__:
- `item.get("organization", {}).get("slug")` → `company_slug`
- `item.get("organization", {}).get("headCount")` → `company_size` (map headcount to label)
- `item.get("seniority")` → `seniority`
- `item.get("workMode")` → split remote vs hybrid
- Set `source_platform="getro"`

- [ ] **Step 4: Test the expanded parsers**

```bash
python -c "
import asyncio
from scrapers.consider import ConsiderScraper
async def test():
    s = ConsiderScraper({'name': 'Sequoia Capital', 'url': 'https://jobs.sequoiacap.com/jobs', 'board_slug': 'sequoia-capital'})
    jobs = await s.scrape()
    j = jobs[0]
    print(f'Company: {j.company}, Seniority: {j.seniority}, Salary: {j.salary_min}-{j.salary_max} {j.salary_currency}')
    print(f'Department: {j.department}, Industry: {j.industry}, Skills: {j.skills}')
    print(f'Company size: {j.company_size}, Domain: {j.company_domain}')
asyncio.run(test())
"
```

- [ ] **Step 5: Commit**

```bash
git add scrapers/
git commit -m "feat: expand Job dataclass with salary, seniority, skills, industry fields"
```

---

## Task 3: Refactor aggregate.py to write to Turso

**Files:**
- Modify: `scripts/aggregate.py`

- [ ] **Step 1: Add Turso write functions**

Add to `aggregate.py`:
- `get_turso_client()`: Creates libsql connection from env vars
- `get_known_urls(client)`: `SELECT url FROM jobs` → set of strings
- `upsert_jobs(client, jobs)`: Batch upsert with `INSERT INTO jobs ... ON CONFLICT(id) DO UPDATE SET ...` (not INSERT OR REPLACE, which would cascade-delete vc_backers) and separate inserts to `job_vc_backers`
- `prune_old_jobs_db(client, max_age_days)`: `DELETE FROM jobs WHERE posted_date < ?`

- [ ] **Step 2: Update run() to use Turso instead of JSON**

Replace the JSON read/write flow:
1. Load known URLs from DB (instead of JSON file)
2. Scrape as before
3. Deduplicate new jobs (keep the Python dedup for cross-board merging of vc_backers)
4. Upsert into Turso (instead of writing JSON)
5. Prune old jobs in DB

Keep `--full` flag: when set, `DELETE FROM jobs` before upserting.

- [ ] **Step 3: Generate a URL-based job ID**

Add a helper `job_id(url: str) -> str` that returns a SHA-256 hash (first 16 hex chars) of the URL. Used as the primary key.

- [ ] **Step 4: Test the full pipeline**

```bash
python scripts/aggregate.py --platforms consider --full
turso db shell jobslop "SELECT COUNT(*) FROM jobs;"
turso db shell jobslop "SELECT company, title, seniority, salary_min FROM jobs LIMIT 5;"
turso db shell jobslop "SELECT vc_name, COUNT(*) FROM job_vc_backers GROUP BY vc_name;"
```

- [ ] **Step 5: Commit**

```bash
git add scripts/aggregate.py
git commit -m "feat: aggregate.py writes to Turso DB instead of JSON"
```

---

## Task 4: Scaffold Next.js app

**Files:**
- Create: `web/` directory with all Next.js boilerplate

- [ ] **Step 1: Create the Next.js project**

```bash
cd /Users/sohan/Documents/jobslop
npx create-next-app@latest web --typescript --tailwind --eslint --app --src=false --import-alias "@/*" --use-npm
```

- [ ] **Step 2: Install Turso client**

```bash
cd web
npm install @libsql/client
```

- [ ] **Step 3: Set up environment variables**

Create `web/.env.local`:
```
TURSO_DATABASE_URL=libsql://jobslop-<user>.turso.io
TURSO_AUTH_TOKEN=<token>
```

- [ ] **Step 4: Create the Turso client singleton**

Create `web/lib/db.ts`:
```typescript
import { createClient } from "@libsql/client";

export const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});
```

- [ ] **Step 5: Create TypeScript types**

Create `web/lib/types.ts` with `Job`, `FilterState`, and `SortOption` types matching the DB schema.

- [ ] **Step 6: Verify dev server runs**

```bash
cd web && npm run dev
```

Open http://localhost:3000 to verify the default page loads.

- [ ] **Step 7: Commit**

```bash
git add web/
git commit -m "feat: scaffold Next.js app with Turso client"
```

---

## Task 5: Build query layer

**Files:**
- Create: `web/lib/queries.ts`

- [ ] **Step 1: Write the main query builder**

Create `web/lib/queries.ts` with a `fetchJobs(filters, sort, limit, offset)` function that:
1. Builds a parameterized SQL query with WHERE clauses from filters
2. Keyword search: `WHERE (title LIKE ? OR company LIKE ?)`
3. Multi-value filters: `WHERE seniority IN (?, ?)`
4. Remote toggle: `WHERE remote = 1`
5. Salary range: `WHERE salary_max >= ?`
6. Joins `job_vc_backers` for VC filter: `JOIN job_vc_backers ON ... WHERE vc_name IN (?)`
7. Skills filter: use `json_each(skills)` to query the JSON array column
8. Adds ORDER BY from sort param (posted_date, salary_max, company_size)
8. LIMIT/OFFSET for pagination
9. Returns `{ jobs: Job[], total: number }`

- [ ] **Step 2: Write the filter options query**

Add `fetchFilterOptions()` that returns distinct values for each filter dropdown:
```sql
SELECT DISTINCT seniority FROM jobs WHERE seniority IS NOT NULL ORDER BY seniority;
SELECT DISTINCT department FROM jobs WHERE department IS NOT NULL ORDER BY department;
SELECT DISTINCT industry FROM jobs WHERE industry IS NOT NULL ORDER BY industry;
SELECT DISTINCT vc_name FROM job_vc_backers ORDER BY vc_name;
```

- [ ] **Step 3: Verify queries work against Turso**

Write a quick test script or add a temporary API route that calls `fetchJobs({})` and logs results.

- [ ] **Step 4: Commit**

```bash
git add web/lib/queries.ts
git commit -m "feat: add SQL query builder for jobs with filters and sorting"
```

---

## Task 6: Build the UI components

**Files:**
- Create: `web/app/components/FilterBar.tsx`
- Create: `web/app/components/FilterDropdown.tsx`
- Create: `web/app/components/JobTable.tsx`
- Create: `web/app/components/JobRow.tsx`
- Create: `web/app/components/Pagination.tsx`
- Modify: `web/app/globals.css`

- [ ] **Step 1: Build FilterDropdown component**

Client component. A button that opens a popover with checkboxes for multi-select. Props: `label`, `options`, `selected`, `onChange`. Dismissible. Shows count badge when filters active. Uses Tailwind for styling — dark theme.

- [ ] **Step 2: Build FilterBar component**

Client component. Top bar containing:
- Search input (debounced, 300ms) on the left
- Row of FilterDropdowns: Location, Seniority, Remote toggle, Department, Industry, VC Backer, Company Size
- Active filter chips below (dismissible)
- Job count and sort dropdown on the right
- Updates URL search params on change via `useRouter` + `useSearchParams`

- [ ] **Step 3: Build JobRow component**

Server component. Single table row showing:
- Company initial avatar (colored based on company name hash)
- Job title (linked)
- Company name
- Location (with remote/hybrid indicator)
- Seniority badge (colored by level)
- Salary range (formatted, or "—")
- Age (human-readable)
- Entire row is an `<a>` tag opening apply URL in new tab

- [ ] **Step 4: Build JobTable component**

Server component. Renders the table header with sortable columns and maps jobs to JobRow components. Column headers are links that toggle sort direction via URL params.

- [ ] **Step 5: Build Pagination component**

Client component. Shows "Load more" button with count (e.g., "Showing 50 of 11,229"). On click, updates URL param `page` to load next batch.

- [ ] **Step 6: Style with globals.css**

Dark theme. Minimal custom CSS beyond Tailwind — mostly utility classes. Ensure the table is responsive: on mobile, hide salary and seniority columns, stack remaining data.

- [ ] **Step 7: Commit**

```bash
git add web/app/components/ web/app/globals.css
git commit -m "feat: build FilterBar, JobTable, and Pagination components"
```

---

## Task 7: Wire up the main page

**Files:**
- Modify: `web/app/page.tsx`
- Modify: `web/app/layout.tsx`

- [ ] **Step 1: Build the main page as a server component**

`web/app/page.tsx`:
1. Read search params from `searchParams` prop
2. Parse filters, sort, and page from URL params
3. Call `fetchJobs(filters, sort, limit, offset)` and `fetchFilterOptions()`
4. Render: header → FilterBar → JobTable → Pagination
5. Pass filter options to FilterBar, jobs to JobTable

- [ ] **Step 2: Update layout.tsx**

Set metadata (title, description, favicon). Add dark background, Inter font, container max-width.

- [ ] **Step 3: Verify the full page works**

```bash
cd web && npm run dev
```

Open http://localhost:3000. Verify:
- Jobs load from Turso
- Search filters results
- Dropdown filters work
- Sort toggles work
- Load more works
- URL updates with each interaction

- [ ] **Step 4: Commit**

```bash
git add web/app/page.tsx web/app/layout.tsx
git commit -m "feat: wire up main page with server-side data fetching"
```

---

## Task 8: Use impeccable to polish the UI

**Files:**
- Modify: `web/app/components/*.tsx`
- Modify: `web/app/globals.css`

- [ ] **Step 1: Run impeccable:frontend-design on the completed UI**

Use the `impeccable:frontend-design` skill to review and polish the entire job board interface. Focus on:
- Visual hierarchy and typography
- Spacing and alignment of the table rows
- Filter bar feel and interaction polish
- Color palette consistency (dark theme)
- Mobile responsiveness
- Micro-interactions (hover states, transitions)

- [ ] **Step 2: Apply feedback and iterate**

Make changes suggested by impeccable. Focus on ease of use as the primary goal.

- [ ] **Step 3: Commit**

```bash
git add web/
git commit -m "style: polish UI with impeccable design review"
```

---

## Task 9: Deploy to Vercel

**Files:**
- Modify: `web/` (Vercel config if needed)

- [ ] **Step 1: Build and test locally**

```bash
cd web
npm run build
npm start
```

Verify production build works at http://localhost:3000.

- [ ] **Step 2: Deploy with Vercel CLI**

```bash
cd web
vercel --prod
```

Set environment variables when prompted (or via CLI):
```bash
vercel env add TURSO_DATABASE_URL production
vercel env add TURSO_AUTH_TOKEN production
```

- [ ] **Step 3: Verify production deployment**

Open the Vercel URL. Verify all features work: search, filters, sort, pagination, job links.

- [ ] **Step 4: Commit any Vercel config changes**

```bash
git add web/
git commit -m "chore: deploy to Vercel"
```

---

## Task 10: Update GitHub Actions for new pipeline

**Files:**
- Modify: `.github/workflows/scrape.yml`

- [ ] **Step 1: Update the workflow**

Update `.github/workflows/scrape.yml`:
1. Remove the README generation step
2. Remove the git commit/push step (no more README updates)
3. Add `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` as secrets
4. Pass secrets as env vars to the scraper
5. The scraper now writes directly to Turso — no git changes needed

```yaml
env:
  TURSO_DATABASE_URL: ${{ secrets.TURSO_DATABASE_URL }}
  TURSO_AUTH_TOKEN: ${{ secrets.TURSO_AUTH_TOKEN }}
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/scrape.yml
git commit -m "chore: update GitHub Actions to write to Turso instead of README"
```
