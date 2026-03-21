"""
Migration script for Turso database.

Creates tables from schema.sql and optionally loads existing job data
from data/jobs.json into the database.

Uses the Turso HTTP pipeline API directly for maximum reliability.
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
BATCH_SIZE = 200  # rows per HTTP request


def get_turso_config():
    load_dotenv(ROOT_DIR / ".env")
    url = os.getenv("TURSO_DATABASE_URL", "")
    token = os.getenv("TURSO_AUTH_TOKEN", "")
    if not url or not token:
        print("Error: TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must be set in .env")
        sys.exit(1)
    # Convert libsql:// to https:// for HTTP API
    http_url = url.replace("libsql://", "https://")
    return http_url, token


def execute_sql(http_url, token, statements):
    """Execute a list of SQL statements via Turso HTTP pipeline API."""
    reqs = []
    for sql, args in statements:
        stmt = {"sql": sql}
        if args:
            stmt["args"] = [_to_value(a) for a in args]
        reqs.append({"type": "execute", "stmt": stmt})
    if not reqs:
        return []
    reqs.append({"type": "close"})
    resp = requests.post(
        f"{http_url}/v2/pipeline",
        json={"requests": reqs},
        headers={"Authorization": f"Bearer {token}"},
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()
    results = data.get("results", [])
    for r in results:
        if r.get("type") == "error":
            err = r.get("error", {})
            print(f"  SQL error: {err.get('message', err)}")
    return results


def _to_value(v):
    if v is None:
        return {"type": "null", "value": None}
    if isinstance(v, int):
        return {"type": "integer", "value": str(v)}
    if isinstance(v, float):
        return {"type": "float", "value": v}
    return {"type": "text", "value": str(v)}


def generate_id(url):
    return hashlib.sha256(url.encode()).hexdigest()[:16]


def run_schema(http_url, token):
    print("Running schema.sql ...")
    schema_sql = SCHEMA_PATH.read_text()
    stmts = [(s.strip(), None) for s in schema_sql.split(";") if s.strip()]
    execute_sql(http_url, token, stmts)
    print("Schema applied successfully.")


def load_jobs(http_url, token):
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
            execute_sql(http_url, token, batch)
            batch = []
            print(f"  {inserted}/{len(jobs)} jobs ...")

    # Flush remaining jobs
    if batch:
        execute_sql(http_url, token, batch)

    # Insert VC backers in batches
    print(f"Inserting {len(vc_batch)} VC backer associations ...")
    for i in range(0, len(vc_batch), BATCH_SIZE):
        execute_sql(http_url, token, vc_batch[i : i + BATCH_SIZE])

    print(f"Import complete: {inserted} jobs processed.")


def verify(http_url, token):
    print("\nVerification:")
    for table in ("jobs", "job_vc_backers", "vc_boards"):
        results = execute_sql(http_url, token, [(f"SELECT COUNT(*) FROM {table}", None)])
        count = results[0]["response"]["result"]["rows"][0][0]["value"]
        print(f"  {table}: {count} rows")


def main():
    http_url, token = get_turso_config()
    print(f"Connecting to {http_url[:40]}...")
    run_schema(http_url, token)
    load_jobs(http_url, token)
    verify(http_url, token)
    print("\nMigration complete!")


if __name__ == "__main__":
    main()
