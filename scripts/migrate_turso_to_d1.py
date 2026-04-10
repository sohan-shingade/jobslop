"""One-time migration: export all data from Turso and import into Cloudflare D1.

Reads TURSO_* and CLOUDFLARE_* env vars from .env.
Uses multi-row INSERT VALUES for efficiency.
"""

import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import requests
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

# Turso config
TURSO_URL = os.getenv("TURSO_DATABASE_URL", "").replace("libsql://", "https://")
TURSO_TOKEN = os.getenv("TURSO_AUTH_TOKEN", "")

# D1 config
CF_ACCT = os.getenv("CLOUDFLARE_ACCT_ID", "")
CF_DB = os.getenv("CLOUDFLARE_DB_ID", "")
CF_KEY = os.getenv("CLOUDFLARE_API_KEY", "")
D1_URL = f"https://api.cloudflare.com/client/v4/accounts/{CF_ACCT}/d1/database/{CF_DB}/query"


def turso_query(sql):
    """Query Turso and return rows as list of dicts."""
    resp = requests.post(
        f"{TURSO_URL}/v2/pipeline",
        json={"requests": [
            {"type": "execute", "stmt": {"sql": sql}},
            {"type": "close"},
        ]},
        headers={"Authorization": f"Bearer {TURSO_TOKEN}"},
        timeout=60,
    )
    resp.raise_for_status()
    data = resp.json()
    result = data["results"][0]["response"]["result"]
    cols = [c["name"] for c in result["cols"]]
    rows = []
    for row in result["rows"]:
        rows.append({cols[i]: cell.get("value") for i, cell in enumerate(row)})
    return rows


def d1_exec(sql, params=None):
    """Execute a single statement on D1."""
    body = {"sql": sql}
    if params:
        body["params"] = params
    resp = requests.post(
        D1_URL, json=body,
        headers={"Authorization": f"Bearer {CF_KEY}", "Content-Type": "application/json"},
        timeout=120,
    )
    data = resp.json()
    if not resp.ok or not data.get("success"):
        print(f"  D1 error ({resp.status_code}): {data.get('errors')}")
        if not resp.ok:
            raise Exception(f"D1 API {resp.status_code}: {data.get('errors')}")
    return data


JOB_COLS = [
    "id", "title", "company", "company_slug", "company_size", "company_domain",
    "location", "remote", "hybrid", "url", "posted_date", "seniority",
    "salary_min", "salary_max", "salary_currency", "salary_period",
    "department", "job_type", "industry", "skills", "category", "source_platform",
    "hiring_period", "education_level", "created_at", "updated_at",
]


def _build_job_insert(batch):
    """Build a multi-row INSERT for a batch of job rows."""
    placeholders = ", ".join(
        ["(" + ", ".join(["?"] * len(JOB_COLS)) + ")"] * len(batch)
    )
    sql = f"INSERT OR IGNORE INTO jobs ({', '.join(JOB_COLS)}) VALUES {placeholders}"
    params = []
    for row in batch:
        for col in JOB_COLS:
            val = row.get(col)
            if col in ("remote", "hybrid", "salary_min", "salary_max") and val is not None:
                try:
                    val = int(val)
                except (ValueError, TypeError):
                    pass
            params.append(val)
    return sql, params


def migrate_jobs(jobs):
    """Insert jobs in multi-row batches with concurrent requests."""
    BATCH = 3  # 3 * 26 cols = 78 params (D1 limit ~100)
    total = len(jobs)
    done = 0
    errors = 0

    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = {}
        for i in range(0, total, BATCH):
            batch = jobs[i:i + BATCH]
            sql, params = _build_job_insert(batch)
            f = pool.submit(d1_exec, sql, params)
            futures[f] = i

        for f in as_completed(futures):
            done += BATCH
            try:
                f.result()
            except Exception as e:
                errors += 1
                if errors <= 3:
                    print(f"\n  Error: {e}")
            print(f"  Jobs: {min(done, total)}/{total} (errors: {errors})", end="\r")
    print()


def migrate_vc_backers(backers):
    """Insert VC backers in multi-row batches with concurrent requests."""
    BATCH = 40  # 40 * 2 = 80 params
    total = len(backers)
    done = 0
    errors = 0

    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = {}
        for i in range(0, total, BATCH):
            batch = backers[i:i + BATCH]
            placeholders = ", ".join(["(?, ?)"] * len(batch))
            sql = f"INSERT OR IGNORE INTO job_vc_backers (job_id, vc_name) VALUES {placeholders}"
            params = []
            for row in batch:
                params.extend([row["job_id"], row["vc_name"]])
            f = pool.submit(d1_exec, sql, params)
            futures[f] = i

        for f in as_completed(futures):
            done += BATCH
            try:
                f.result()
            except Exception as e:
                errors += 1
                if errors <= 3:
                    print(f"\n  Error: {e}")
            print(f"  VC backers: {min(done, total)}/{total} (errors: {errors})", end="\r")
    print()


def main():
    if not TURSO_URL or not TURSO_TOKEN:
        print("Missing TURSO_DATABASE_URL / TURSO_AUTH_TOKEN in .env")
        sys.exit(1)
    if not CF_ACCT or not CF_DB or not CF_KEY:
        print("Missing CLOUDFLARE_* vars in .env")
        sys.exit(1)

    print("Exporting from Turso...")
    jobs = turso_query("SELECT * FROM jobs")
    print(f"  {len(jobs)} jobs")
    backers = turso_query("SELECT * FROM job_vc_backers")
    print(f"  {len(backers)} VC backer associations")

    print("\nImporting into D1...")
    t0 = time.time()
    migrate_jobs(jobs)
    migrate_vc_backers(backers)
    elapsed = time.time() - t0
    print(f"\nMigration complete in {elapsed:.1f}s")

    # Verify
    r = d1_exec("SELECT COUNT(*) as cnt FROM jobs")
    cnt = r["result"][0]["results"][0]["cnt"]
    print(f"D1 jobs: {cnt}")
    r = d1_exec("SELECT COUNT(*) as cnt FROM job_vc_backers")
    cnt = r["result"][0]["results"][0]["cnt"]
    print(f"D1 vc_backers: {cnt}")


if __name__ == "__main__":
    main()
