import { db } from "./db";
import type { Job, Filters, SortField, SortDir, FilterOptions } from "./types";
import type { Row } from "@libsql/client";

const PAGE_SIZE = 50;

function buildWhereClause(
  filters: Filters
): { where: string; params: (string | number)[] } {
  const clauses: string[] = [];
  const params: (string | number)[] = [];

  if (filters.q) {
    clauses.push("(j.title LIKE ? OR j.company LIKE ?)");
    const q = `%${filters.q}%`;
    params.push(q, q);
  }

  if (filters.remote) {
    clauses.push("j.remote = 1");
  }

  if (filters.seniority?.length) {
    clauses.push(`j.seniority IN (${filters.seniority.map(() => "?").join(",")})`);
    params.push(...filters.seniority);
  }

  if (filters.department?.length) {
    clauses.push(`j.department IN (${filters.department.map(() => "?").join(",")})`);
    params.push(...filters.department);
  }

  if (filters.industry?.length) {
    clauses.push(`j.industry IN (${filters.industry.map(() => "?").join(",")})`);
    params.push(...filters.industry);
  }

  if (filters.category?.length) {
    clauses.push(`j.category IN (${filters.category.map(() => "?").join(",")})`);
    params.push(...filters.category);
  }

  if (filters.company_size?.length) {
    clauses.push(`j.company_size IN (${filters.company_size.map(() => "?").join(",")})`);
    params.push(...filters.company_size);
  }

  if (filters.vc?.length) {
    clauses.push(
      `j.id IN (SELECT job_id FROM job_vc_backers WHERE vc_name IN (${filters.vc.map(() => "?").join(",")}))`
    );
    params.push(...filters.vc);
  }

  const where = clauses.length > 0 ? "WHERE " + clauses.join(" AND ") : "";
  return { where, params };
}

function buildOrderBy(sort: SortField, dir: SortDir): string {
  const col = {
    posted_date: "j.posted_date",
    salary_max: "j.salary_max",
    company: "j.company",
  }[sort] || "j.posted_date";

  // Handle nulls: push them to the end
  if (dir === "desc") {
    return `ORDER BY ${col} IS NULL, ${col} DESC`;
  }
  return `ORDER BY ${col} IS NULL, ${col} ASC`;
}

function rowToJob(row: Row): Job {
  return {
    id: row.id as string,
    title: row.title as string,
    company: row.company as string,
    company_slug: row.company_slug as string | null,
    company_size: row.company_size as string | null,
    company_domain: row.company_domain as string | null,
    location: row.location as string | null,
    remote: (row.remote as number) === 1,
    hybrid: (row.hybrid as number) === 1,
    url: row.url as string,
    posted_date: row.posted_date as string | null,
    seniority: row.seniority as string | null,
    salary_min: row.salary_min as number | null,
    salary_max: row.salary_max as number | null,
    salary_currency: row.salary_currency as string | null,
    salary_period: row.salary_period as string | null,
    department: row.department as string | null,
    job_type: row.job_type as string | null,
    industry: row.industry as string | null,
    skills: row.skills as string | null,
    category: row.category as string | null,
    source_platform: row.source_platform as string | null,
    vc_backers: row.vc_backers ? (row.vc_backers as string).split(",") : [],
  };
}

export async function fetchJobs(
  filters: Filters,
  sort: SortField = "posted_date",
  dir: SortDir = "desc",
  page: number = 1
): Promise<{ jobs: Job[]; total: number }> {
  const { where, params } = buildWhereClause(filters);
  const orderBy = buildOrderBy(sort, dir);
  const offset = (page - 1) * PAGE_SIZE;

  // Count query
  const countResult = await db.execute({
    sql: `SELECT COUNT(DISTINCT j.id) as cnt FROM jobs j ${where}`,
    args: params,
  });
  const total = countResult.rows[0].cnt as number;

  // Data query with VC backers aggregated
  const dataResult = await db.execute({
    sql: `
      SELECT j.*, GROUP_CONCAT(DISTINCT b.vc_name) as vc_backers
      FROM jobs j
      LEFT JOIN job_vc_backers b ON j.id = b.job_id
      ${where}
      GROUP BY j.id
      ${orderBy}
      LIMIT ? OFFSET ?
    `,
    args: [...params, PAGE_SIZE, offset],
  });

  const jobs = dataResult.rows.map(rowToJob);
  return { jobs, total };
}

export async function fetchFilterOptions(): Promise<FilterOptions> {
  const [seniorities, departments, industries, vcs, companySizes, locations, categories] =
    await Promise.all([
      db.execute("SELECT DISTINCT seniority FROM jobs WHERE seniority IS NOT NULL AND seniority != '' ORDER BY seniority"),
      db.execute("SELECT DISTINCT department FROM jobs WHERE department IS NOT NULL AND department != '' ORDER BY department"),
      db.execute("SELECT DISTINCT industry FROM jobs WHERE industry IS NOT NULL AND industry != '' ORDER BY industry"),
      db.execute("SELECT DISTINCT vc_name FROM job_vc_backers ORDER BY vc_name"),
      db.execute("SELECT DISTINCT company_size FROM jobs WHERE company_size IS NOT NULL AND company_size != '' ORDER BY company_size"),
      db.execute("SELECT DISTINCT location FROM jobs WHERE location IS NOT NULL AND location != '' ORDER BY location LIMIT 200"),
      db.execute("SELECT DISTINCT category FROM jobs WHERE category IS NOT NULL AND category != '' ORDER BY category"),
    ]);

  return {
    seniorities: seniorities.rows.map((r) => r.seniority as string),
    departments: departments.rows.map((r) => r.department as string),
    industries: industries.rows.map((r) => r.industry as string),
    vcs: vcs.rows.map((r) => r.vc_name as string),
    company_sizes: companySizes.rows.map((r) => r.company_size as string),
    locations: locations.rows.map((r) => r.location as string),
    categories: categories.rows.map((r) => r.category as string),
  };
}
