# 🚀 VC-Backed Startup Job Aggregator — Architecture & Claude Code Playbook

## What You're Building

A GitHub repo (like `SimplifyJobs/Summer2026-Internships`) that **automatically scrapes 50+ VC portfolio job boards**, deduplicates listings, and renders them into a filterable README table updated daily via GitHub Actions.

**Output format** (Simplify-style markdown table):

```
| Company | Role | Location | VC Backer(s) | Link | Posted |
| ------- | ---- | -------- | ------------ | ---- | ------ |
| **Stripe** | Data Science Intern | SF, CA | Sequoia, a16z | [Apply](url) | 1d |
```

---

## Key Insight: You Don't Need to Scrape HTML

~80% of these VC job boards run on **3 platforms** that serve **structured JSON**:

### Platform Breakdown

| Platform | Powers | Data Access Method |
|----------|--------|-------------------|
| **Getro** | ~35 boards (jobs.sequoiacap.com, jobs.greylock.com, jobs.bvp.com, jobs.generalcatalyst.com, jobs.lsvp.com, etc.) | REST API: `GET https://api.getro.com/v2/networks/{id}/jobs` (requires API key) **OR** scrape the rendered JSON from the page's `__NEXT_DATA__` / XHR calls |
| **Consider** | ~10 boards (consider.com/boards/vc/{slug}/jobs) | Fetch page, parse embedded JSON from Next.js `__NEXT_DATA__` script tag |
| **Greenhouse** | Individual company ATS pages (boards.greenhouse.io) | **Public JSON API**: `GET https://boards-api.greenhouse.io/v1/boards/{token}/jobs` — no auth needed |
| **Lever** | Individual company ATS pages (jobs.lever.co) | **Public JSON API**: `GET https://api.lever.co/v0/postings/{company}` — no auth needed |
| **Custom** | YC (ycombinator.com/jobs), Index Ventures, First Round, etc. | HTML scraping with BeautifulSoup or Playwright |

### The Getro Shortcut (Most Important)

Almost every `jobs.{vc}.com` URL is Getro-powered. When you load these pages, the browser makes XHR requests to Getro's internal API. You can intercept these. The typical pattern:

```
# The page at jobs.sequoiacap.com/jobs loads data from:
GET https://api.getro.com/v2/networks/{network_id}/jobs?page=1&per_page=50

# Response shape:
{
  "items": [
    {
      "id": 12345,
      "title": "Software Engineer",
      "company": { "name": "Stripe", "slug": "stripe", "logo_url": "..." },
      "locations": [{ "city": "San Francisco", "state": "CA", "country": "US" }],
      "job_functions": ["Engineering"],
      "url": "https://stripe.com/jobs/12345",
      "published_at": "2026-03-15T00:00:00Z"
    }
  ],
  "total_count": 5000,
  "page": 1,
  "per_page": 50
}
```

**To find the `network_id`**: Open the job board in a browser, open DevTools → Network tab, filter by "getro", and look at the API calls. Each VC has a unique network ID.

---

## Project Structure

```
vc-job-board/
├── .github/
│   └── workflows/
│       └── scrape.yml          # GitHub Actions cron (runs 2x/day)
├── scrapers/
│   ├── __init__.py
│   ├── base.py                 # Abstract base scraper class
│   ├── getro.py                # Getro-powered boards (covers ~35 VCs)
│   ├── greenhouse.py           # Greenhouse ATS public API
│   ├── lever.py                # Lever ATS public API
│   ├── yc.py                   # Y Combinator custom scraper
│   ├── index_ventures.py       # Index Ventures custom scraper
│   └── consider.py             # Consider-powered boards
├── config/
│   ├── vc_boards.yaml          # Master config: all VC boards + their platform type + IDs
│   └── filters.yaml            # Optional: role keyword filters (intern, data science, quant, etc.)
├── data/
│   ├── jobs.json               # Raw aggregated job data (gitignored or committed)
│   └── jobs_history.json       # Historical tracking for "Age" column
├── scripts/
│   ├── aggregate.py            # Main orchestrator: runs all scrapers, deduplicates, outputs JSON
│   ├── generate_readme.py      # Converts jobs.json → README.md table
│   └── deduplicate.py          # Dedup logic (same company + similar title + same location)
├── README.md                   # The auto-generated job listing table
├── CONTRIBUTING.md
├── requirements.txt
└── pyproject.toml
```

---

## Step-by-Step: What to Tell Claude Code

### Phase 1: Scaffold the Project

```
Create a Python project called "vc-job-board" with the structure above. 
Use Python 3.11+, httpx for async HTTP, pyyaml for config, and 
rapidfuzz for fuzzy deduplication. Set up pyproject.toml with these deps.
```

### Phase 2: Build the Config File

```yaml
# config/vc_boards.yaml
boards:
  # === GETRO-POWERED (biggest batch) ===
  - name: "Sequoia Capital"
    platform: getro
    url: "https://jobs.sequoiacap.com/jobs"
    # network_id needs to be discovered via browser DevTools
    network_id: null  # TODO: discover
    
  - name: "Greylock Partners"
    platform: getro
    url: "https://jobs.greylock.com/jobs"
    network_id: null
    
  - name: "Bessemer Venture Partners"
    platform: getro
    url: "https://jobs.bvp.com/jobs"
    network_id: null

  - name: "General Catalyst"
    platform: getro
    url: "https://jobs.generalcatalyst.com/jobs"
    network_id: null

  - name: "Lightspeed Venture Partners"
    platform: getro
    url: "https://jobs.lsvp.com/jobs"
    network_id: null

  - name: "Kleiner Perkins"
    platform: getro
    url: "https://jobs.kleinerperkins.com/jobs"
    network_id: null

  - name: "Khosla Ventures"
    platform: getro
    url: "https://jobs.khoslaventures.com/jobs"
    network_id: null

  - name: "Accel"
    platform: getro
    url: "https://jobs.accel.com/"
    network_id: null

  - name: "Thrive Capital"
    platform: getro
    url: "https://jobs.thrivecap.com/jobs"
    network_id: null

  - name: "Redpoint Ventures"
    platform: getro
    url: "https://careers.redpoint.com/jobs"
    network_id: null

  - name: "Menlo Ventures"
    platform: getro
    url: "https://jobs.menlovc.com/jobs"
    network_id: null

  - name: "Battery Ventures"
    platform: getro
    url: "https://jobs.battery.com/jobs"
    network_id: null

  - name: "Insight Partners"
    platform: getro
    url: "https://jobs.insightpartners.com/jobs"
    network_id: null

  - name: "Madrona"
    platform: getro
    url: "https://jobs.madrona.com/jobs"
    network_id: null

  - name: "Craft Ventures"
    platform: getro
    url: "https://jobs.craftventures.com/jobs"
    network_id: null

  - name: "NFX"
    platform: getro
    url: "https://jobs.nfx.com/jobs"
    network_id: null

  - name: "Union Square Ventures"
    platform: getro
    url: "https://jobs.usv.com/jobs"
    network_id: null

  - name: "Foundry Group"
    platform: getro
    url: "https://jobs.foundry.vc/jobs"
    network_id: null

  - name: "Floodgate"
    platform: getro
    url: "https://jobs.floodgate.com/jobs"
    network_id: null

  - name: "Lux Capital"
    platform: getro
    url: "https://jobs.luxcapital.com/jobs"
    network_id: null

  - name: "Sapphire Ventures"
    platform: getro
    url: "https://jobs.sapphireventures.com/jobs"
    network_id: null

  - name: "Notation Capital"
    platform: getro
    url: "https://jobs.notationcapital.com/jobs"
    network_id: null

  - name: "GV (Google Ventures)"
    platform: getro
    url: "https://jobs.gv.com/jobs"
    network_id: null

  - name: "NEA"
    platform: getro
    url: "https://careers.nea.com/jobs"
    network_id: null

  - name: "Andreessen Horowitz"
    platform: getro  
    url: "https://portfoliojobs.a16z.com/jobs"
    network_id: null

  - name: "Point72 Ventures"
    platform: getro
    url: "https://p72.getro.com/jobs"
    network_id: null

  - name: "Wing Venture Capital"
    platform: getro
    url: "https://careers.wing.vc/"
    network_id: null

  - name: "IVP"
    platform: getro
    url: "https://careers.ivp.com/"
    network_id: null

  - name: "DFJ Growth"
    platform: getro
    url: "https://careers.dfjgrowth.com/jobs"
    network_id: null

  - name: "Emergence Capital"
    platform: getro
    url: "https://talent.emcap.com/jobs"
    network_id: null

  - name: "SoftBank Vision Fund"
    platform: getro
    url: "https://careers.visionfund.com/"
    network_id: null

  - name: "Summit Partners"
    platform: getro
    url: "https://jobs.summitpartners.com/"
    network_id: null

  - name: "Primary Venture Partners"
    platform: getro
    url: "https://jobs.primary.vc/jobs"
    network_id: null

  - name: "SV Angel"
    platform: getro
    url: "https://jobs.svangel.com/jobs"
    network_id: null

  - name: "Kapor Capital"
    platform: getro
    url: "https://jobs.kaporcapital.com/jobs"
    network_id: null

  - name: "Greycroft"
    platform: getro
    url: "https://jobs.greycroft.com/companies"
    network_id: null

  - name: "Upfront Ventures"
    platform: getro
    url: "https://jobs.upfront.com/jobs"
    network_id: null

  - name: "True Ventures"
    platform: getro
    url: "https://jobs.trueventures.com/companies"
    network_id: null

  - name: "BOLDstart Ventures"
    platform: getro
    url: "https://jobs.boldstart.vc/companies"
    network_id: null

  - name: "SOSV"
    platform: getro
    url: "https://jobs.sosv.com/jobs"
    network_id: null

  - name: "Goodwater Capital"
    platform: getro
    url: "https://jobs.goodwatercap.com/jobs"
    network_id: null

  - name: "Panoramic Ventures"
    platform: getro
    url: "https://jobs.panoramic.vc/jobs"
    network_id: null

  - name: "BITKRAFT Ventures"
    platform: getro
    url: "https://jobs.bitkraft.vc/jobs"
    network_id: null

  - name: "GSV Ventures"
    platform: getro
    url: "https://gsv.getro.com/jobs"
    network_id: null

  # === CUSTOM SCRAPERS ===
  - name: "Y Combinator"
    platform: yc
    url: "https://www.ycombinator.com/jobs"

  - name: "Index Ventures"
    platform: custom
    url: "https://www.indexventures.com/startup-jobs"

  - name: "First Round Capital"
    platform: custom
    url: "https://firstround.com/talent/"

  - name: "Atomico"
    platform: custom
    url: "https://careers.atomico.com/"

  - name: "Contrary"
    platform: custom
    url: "https://contrary.com/talent"

  - name: "Pear VC"
    platform: custom
    url: "https://pear.vc/talent/"
```

### Phase 3: Build the Scraper Classes

Tell Claude Code:

```
Build the scraper system with this architecture:

1. base.py — Abstract base class:
   - async def scrape() -> list[Job]
   - Job is a dataclass: company, role, location, url, posted_date, vc_backer, job_function
   
2. getro.py — Single scraper that handles ALL Getro-powered boards:
   
   APPROACH A (preferred — no API key needed):
   Use Playwright (headless browser) to load the job board page, then
   intercept the XHR requests to api.getro.com to capture the network_id
   and job data. Cache discovered network_ids to config.
   
   APPROACH B (fallback — HTML parsing):
   Load the page with httpx, look for embedded JSON in <script> tags
   (Next.js __NEXT_DATA__ or similar hydration payloads).
   
   APPROACH C (if you can get an API key):
   Direct Getro API calls: GET https://api.getro.com/v2/networks/{id}/jobs
   Paginate through all results (50 per page).

   The scraper should:
   - Accept a list of board configs from vc_boards.yaml
   - Scrape each board with rate limiting (2 sec between requests)
   - Return normalized Job objects
   
3. greenhouse.py — For companies using Greenhouse ATS:
   Public API, no auth: GET https://boards-api.greenhouse.io/v1/boards/{token}/jobs
   Returns clean JSON. No scraping needed.
   
4. lever.py — For companies using Lever ATS:
   Public API, no auth: GET https://api.lever.co/v0/postings/{company}
   Returns clean JSON.

5. yc.py — Custom scraper for Y Combinator's /jobs page.
   YC's job board uses a React frontend. Use Playwright or check for 
   an underlying API endpoint in the network tab.

6. consider.py — For Consider-powered boards:
   Fetch the page HTML, parse the __NEXT_DATA__ JSON blob from the
   <script id="__NEXT_DATA__"> tag.
```

### Phase 4: Build the Aggregator + Deduplicator

```
Build scripts/aggregate.py:
1. Load config/vc_boards.yaml
2. For each board, instantiate the right scraper class
3. Run all scrapers concurrently (asyncio.gather with semaphore of 5)
4. Merge all results into a single list
5. Run deduplication:
   - Key = (normalized_company_name, normalized_role_title, city)
   - Use rapidfuzz for fuzzy matching (threshold 85%)
   - When duplicates found, merge vc_backer lists (a job at Stripe 
     might appear on both Sequoia and a16z boards)
6. Sort by posted_date descending
7. Write to data/jobs.json

Build scripts/generate_readme.py:
1. Read data/jobs.json
2. Group jobs by category (Software Engineering, Data Science, 
   Quant Finance, Product Management, Other)
3. Generate markdown table matching SimplifyJobs format:

   | Company | Role | Location | VC Backer(s) | Link | Age |
   
4. "Age" = human-readable time since posted (1d, 3d, 1w, 2w, 1mo)
5. Add legend, section headers, and jump links
6. Write to README.md
```

### Phase 5: GitHub Actions Automation

```yaml
# .github/workflows/scrape.yml
name: Scrape VC Job Boards

on:
  schedule:
    - cron: '0 8,20 * * *'  # Run at 8am and 8pm UTC daily
  workflow_dispatch:  # Manual trigger

jobs:
  scrape:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'
          
      - name: Install dependencies
        run: pip install -r requirements.txt
        
      - name: Install Playwright browsers
        run: playwright install chromium
        
      - name: Run scraper
        run: python scripts/aggregate.py
        
      - name: Generate README
        run: python scripts/generate_readme.py
        
      - name: Commit and push
        run: |
          git config user.name "VC Job Bot"
          git config user.email "bot@vcjobs.dev"
          git add data/jobs.json README.md
          git diff --staged --quiet || git commit -m "Update job listings $(date -u +%Y-%m-%d)"
          git push
```

---

## Phase 6 (Optional): Web Frontend

If you want a nice web UI on top of the GitHub data:

```
Build a simple Next.js or Astro site that:
1. Reads data/jobs.json at build time
2. Renders a filterable/searchable table with:
   - Search by company, role title, location
   - Filter by VC backer (multi-select dropdown)
   - Filter by category (SWE, DS, Quant, PM)
   - Filter by location (Bay Area, NYC, Remote, etc.)
   - Sort by date posted
3. Deploy to Vercel/Netlify with a GitHub webhook that
   rebuilds on every push to main
```

---

## The Exact Claude Code Prompt to Start

Copy this into Claude Code to get the project bootstrapped:

```
Create a Python project called "vc-job-board" that aggregates job listings 
from 50+ venture capital portfolio job boards into a single GitHub README 
table (like SimplifyJobs/Summer2026-Internships).

KEY ARCHITECTURE DECISIONS:
- Most boards (35+) are Getro-powered. Use Playwright to load pages and 
  intercept XHR calls to api.getro.com, extracting structured JSON job data.
  Fall back to parsing __NEXT_DATA__ script tags if XHR interception fails.
- Greenhouse ATS: public JSON API at boards-api.greenhouse.io (no auth)
- Lever ATS: public JSON API at api.lever.co (no auth)  
- YC, Index Ventures, etc.: custom HTML scrapers

PROJECT STRUCTURE:
- scrapers/ — adapter pattern with base class + platform-specific scrapers
- config/vc_boards.yaml — master list of all 50+ boards with platform type
- scripts/aggregate.py — orchestrator that runs all scrapers async
- scripts/generate_readme.py — converts JSON to Simplify-style markdown table
- scripts/deduplicate.py — fuzzy dedup using rapidfuzz
- .github/workflows/scrape.yml — cron job running 2x/day
- README.md — auto-generated output

JOB DATA MODEL:
@dataclass
class Job:
    company: str
    role: str
    location: str
    url: str
    posted_date: datetime
    vc_backers: list[str]
    category: str  # SWE, Data Science, Quant, PM, Other
    remote: bool

README OUTPUT FORMAT:
## 💻 Software Engineering
| Company | Role | Location | VC Backer(s) | Link | Age |
| ------- | ---- | -------- | ------------ | ---- | --- |
| **Stripe** | Backend Engineer | SF, CA | Sequoia, a16z | [Apply](url) | 1d |

DEPENDENCIES: httpx, playwright, pyyaml, rapidfuzz, beautifulsoup4

Start by creating the full project scaffold, then implement the Getro 
scraper first since it covers the most boards. Include robust error 
handling, rate limiting (2s between requests), and logging.
```

---

## Getting the Getro Network IDs (The Manual Step)

Before the scraper can use the Getro API directly, you need each board's network ID. Here's how:

1. Open `jobs.sequoiacap.com/jobs` in Chrome
2. Open DevTools → Network tab
3. Filter by `getro` or `api.getro`
4. Reload the page
5. Look for requests like `GET https://api.getro.com/v2/networks/123/jobs?page=1`
6. The `123` in that URL is the `network_id`
7. Add it to `config/vc_boards.yaml`

**OR** automate this with Playwright:

```python
async def discover_network_id(page_url: str) -> int:
    """Load a Getro-powered job board and intercept API calls to find network_id."""
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        
        network_id = None
        
        def handle_request(request):
            nonlocal network_id
            if 'api.getro.com' in request.url and '/networks/' in request.url:
                # Extract network ID from URL like /v2/networks/123/jobs
                parts = request.url.split('/networks/')[1].split('/')
                network_id = int(parts[0])
        
        page.on('request', handle_request)
        await page.goto(page_url, wait_until='networkidle')
        await browser.close()
        return network_id
```

---

## Scaling Tips

- **Start small**: Get Getro working for 5 boards first, then expand
- **Cache aggressively**: Store network_ids after discovery so you don't need Playwright every run  
- **Incremental scraping**: Track `last_scraped_at` per board; only fetch new pages if jobs count changed
- **GitHub rate limits**: Keep README under 500KB (filter to only recent jobs, last 30 days)
- **Respect robots.txt**: These are portfolio job boards meant to be public, but still rate-limit politely

---

## Summary of Effort

| Phase | What | Effort |
|-------|------|--------|
| 1 | Project scaffold + config | 30 min with Claude Code |
| 2 | Getro scraper (covers 35+ boards) | 2-3 hours |
| 3 | Greenhouse + Lever scrapers | 1 hour |
| 4 | Custom scrapers (YC, Index, etc.) | 2 hours |
| 5 | Dedup + README generator | 1-2 hours |
| 6 | GitHub Actions CI/CD | 30 min |
| 7 | Network ID discovery automation | 1 hour |
| **Total** | | **~8-10 hours** |

The Getro scraper alone gets you 70%+ of the value since it covers the majority of boards.