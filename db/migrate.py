"""
Migration script for Cloudflare D1 database.

Creates tables from schema.sql and optionally loads existing job data
from data/jobs.json into the database.

Uses the Cloudflare D1 REST API.
"""

import hashlib
import json
import os
import sys
from pathlib import Path

import requests
from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parent.parent
SCHEMA_PATH = Path(__file__).resolve().parent / "schema.sql"
JOBS_JSON_PATH = ROOT_DIR / "data" / "jobs.json"
BATCH_SIZE = 100  # rows per HTTP request


def get_d1_config():
    load_dotenv(ROOT_DIR / ".env")
    acct_id = os.getenv("CLOUDFLARE_ACCT_ID", "")
    db_id = os.getenv("CLOUDFLARE_DB_ID", "")
    api_key = os.getenv("CLOUDFLARE_API_KEY", "")
    if not acct_id or not db_id or not api_key:
        print("Error: CLOUDFLARE_ACCT_ID, CLOUDFLARE_DB_ID, and CLOUDFLARE_API_KEY must be set in .env")
        sys.exit(1)
    url = f"https://api.cloudflare.com/client/v4/accounts/{acct_id}/d1/database/{db_id}/query"
    return url, api_key


def execute_sql(api_url, token, statements):
    """Execute a list of SQL statements via D1 REST API (one request per statement)."""
    if not statements:
        return []
    results = []
    for sql, args in statements:
        body = {"sql": sql}
        if args:
            body["params"] = args
        resp = requests.post(
            api_url,
            json=body,
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
            timeout=60,
        )
        resp.raise_for_status()
        data = resp.json()
        if not data.get("success"):
            for err in data.get("errors", []):
                print(f"  D1 error: {err.get('message', err)}")
        result_list = data.get("result", [{}])
        results.append(result_list[0] if result_list else {})
    return results


def generate_id(url):
    return hashlib.sha256(url.encode()).hexdigest()[:16]


def run_schema(api_url, token):
    print("Running schema.sql ...")
    schema_sql = SCHEMA_PATH.read_text()
    stmts = [(s.strip(), None) for s in schema_sql.split(";") if s.strip()]
    execute_sql(api_url, token, stmts)
    print("Schema applied successfully.")


def load_jobs(api_url, token):
    if not JOBS_JSON_PATH.exists():
        print(f"No jobs file at {JOBS_JSON_PATH}, skipping data load.")
        return

    print(f"Loading jobs from {JOBS_JSON_PATH} ...")
    with open(JOBS_JSON_PATH) as f:
        jobs = json.load(f)
    print(f"Found {len(jobs)} jobs to import.")

    inserted = 0
    batch = []
    vc_batch = []

    for job in jobs:
        url = job.get("url", "")
        title = job.get("role", "")
        company = job.get("company", "")
        if not url or not title or not company:
            continue

        job_id = generate_id(url)
        location = job.get("location")
        remote = 1 if job.get("remote", False) else 0
        posted_date = job.get("posted_date")
        category = job.get("category")

        batch.append((
            "INSERT OR IGNORE INTO jobs (id, title, company, location, remote, url, posted_date, category) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            [job_id, title, company, location, remote, url, posted_date, category],
        ))

        for vc_name in job.get("vc_backers", []):
            vc_batch.append((
                "INSERT OR IGNORE INTO job_vc_backers (job_id, vc_name) VALUES (?, ?)",
                [job_id, vc_name],
            ))

        inserted += 1

        # Flush batch
        if len(batch) >= BATCH_SIZE:
            execute_sql(api_url, token, batch)
            batch = []
            print(f"  {inserted}/{len(jobs)} jobs ...")

    # Flush remaining jobs
    if batch:
        execute_sql(api_url, token, batch)

    # Insert VC backers in batches
    print(f"Inserting {len(vc_batch)} VC backer associations ...")
    for i in range(0, len(vc_batch), BATCH_SIZE):
        execute_sql(api_url, token, vc_batch[i : i + BATCH_SIZE])

    print(f"Import complete: {inserted} jobs processed.")


def verify(api_url, token):
    print("\nVerification:")
    for table in ("jobs", "job_vc_backers", "vc_boards"):
        results = execute_sql(api_url, token, [(f"SELECT COUNT(*) as cnt FROM {table}", None)])
        count = results[0]["results"][0]["cnt"]
        print(f"  {table}: {count} rows")


def main():
    api_url, token = get_d1_config()
    print(f"Connecting to D1...")
    run_schema(api_url, token)
    load_jobs(api_url, token)
    verify(api_url, token)
    print("\nMigration complete!")


if __name__ == "__main__":
    main()
