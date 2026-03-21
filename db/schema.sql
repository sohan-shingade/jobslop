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
