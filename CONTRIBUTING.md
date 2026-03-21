# Contributing

## Adding a new VC job board

1. Open `config/vc_boards.yaml`
2. Add an entry with the board's name, platform type, and URL
3. If it's a Getro-powered board, set `network_id: null` — it will be auto-discovered
4. For other platforms, you may need to add a new scraper in `scrapers/`

## Supported platforms

| Platform | Auto-discovery | Auth needed |
|----------|---------------|-------------|
| Getro | Yes (Playwright intercepts network ID) | No |
| Greenhouse | N/A (public API) | No |
| Lever | N/A (public API) | No |
| Custom | N/A | Varies |

## Running locally

```bash
pip install -r requirements.txt
playwright install chromium

# Scrape all boards
python scripts/aggregate.py

# Scrape only Getro boards
python scripts/aggregate.py --platforms getro

# Generate README from scraped data
python scripts/generate_readme.py
```
