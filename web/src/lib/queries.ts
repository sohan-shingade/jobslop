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

  if (filters.us_only) {
    clauses.push("((j.location LIKE '%USA%' OR j.location LIKE '%United States%' OR j.location LIKE '%, US %' OR j.location LIKE '%, AL%' OR j.location LIKE '%, AK%' OR j.location LIKE '%, AZ%' OR j.location LIKE '%, AR%' OR j.location LIKE '%, CA%' OR j.location LIKE '%, CO%' OR j.location LIKE '%, CT%' OR j.location LIKE '%, DE%' OR j.location LIKE '%, FL%' OR j.location LIKE '%, GA%' OR j.location LIKE '%, HI%' OR j.location LIKE '%, ID%' OR j.location LIKE '%, IL%' OR j.location LIKE '%, IN%' OR j.location LIKE '%, IA%' OR j.location LIKE '%, KS%' OR j.location LIKE '%, KY%' OR j.location LIKE '%, LA%' OR j.location LIKE '%, ME%' OR j.location LIKE '%, MD%' OR j.location LIKE '%, MA%' OR j.location LIKE '%, MI%' OR j.location LIKE '%, MN%' OR j.location LIKE '%, MS%' OR j.location LIKE '%, MO%' OR j.location LIKE '%, MT%' OR j.location LIKE '%, NE%' OR j.location LIKE '%, NV%' OR j.location LIKE '%, NH%' OR j.location LIKE '%, NJ%' OR j.location LIKE '%, NM%' OR j.location LIKE '%, NY%' OR j.location LIKE '%, NC%' OR j.location LIKE '%, ND%' OR j.location LIKE '%, OH%' OR j.location LIKE '%, OK%' OR j.location LIKE '%, OR%' OR j.location LIKE '%, PA%' OR j.location LIKE '%, RI%' OR j.location LIKE '%, SC%' OR j.location LIKE '%, SD%' OR j.location LIKE '%, TN%' OR j.location LIKE '%, TX%' OR j.location LIKE '%, UT%' OR j.location LIKE '%, VT%' OR j.location LIKE '%, VA%' OR j.location LIKE '%, WA%' OR j.location LIKE '%, WV%' OR j.location LIKE '%, WI%' OR j.location LIKE '%, WY%' OR j.location LIKE '%, DC%') AND j.location NOT LIKE '%, CAN' AND j.location NOT LIKE '%CAN %' AND j.location NOT LIKE '%, ON,%CAN%' AND j.location NOT LIKE '%, AB,%CAN%' AND j.location NOT LIKE '%, BC,%CAN%' AND j.location NOT LIKE '%, QC,%CAN%' AND j.location NOT LIKE '%Canada%' AND j.location NOT LIKE '%India%' AND j.location NOT LIKE '%Mexico%' AND j.location NOT LIKE '%United Kingdom%' AND j.location NOT LIKE '%Australia%')");
  }

  if (filters.days) {
    const cutoff = new Date(Date.now() - filters.days * 24 * 60 * 60 * 1000).toISOString();
    clauses.push("j.posted_date >= ?");
    params.push(cutoff);
  }

  if (filters.source === "vc") {
    clauses.push("j.source_platform IN ('consider', 'getro')");
  } else if (filters.source === "simplify") {
    clauses.push("j.source_platform = 'simplify'");
  } else if (filters.source === "banking") {
    clauses.push("(j.industry LIKE '%Financial%' OR j.industry LIKE '%Banking%' OR j.industry LIKE '%Investment%' OR j.industry LIKE '%Capital Markets%')");
  } else if (filters.source === "crypto") {
    clauses.push("j.industry = 'Crypto'");
  }

  if (filters.hiring_period?.length) {
    const hpClauses = filters.hiring_period.map(() =>
      "EXISTS (SELECT 1 FROM json_each(j.hiring_period) WHERE json_each.value = ?)"
    );
    clauses.push(`(${hpClauses.join(" OR ")})`);
    params.push(...filters.hiring_period);
  }

  if (filters.education_level?.length) {
    const elClauses = filters.education_level.map(() =>
      "EXISTS (SELECT 1 FROM json_each(j.education_level) WHERE json_each.value = ?)"
    );
    clauses.push(`(${elClauses.join(" OR ")})`);
    params.push(...filters.education_level);
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
    company_description: row.company_description as string | null,
    hiring_period: row.hiring_period as string | null,
    education_level: row.education_level as string | null,
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
  const [seniorities, departments, industries, vcs, companySizes, locations, categories, hiringPeriods, educationLevels] =
    await Promise.all([
      db.execute("SELECT DISTINCT seniority FROM jobs WHERE seniority IS NOT NULL AND seniority != '' ORDER BY seniority"),
      db.execute("SELECT DISTINCT department FROM jobs WHERE department IS NOT NULL AND department != '' ORDER BY department"),
      db.execute("SELECT DISTINCT industry FROM jobs WHERE industry IS NOT NULL AND industry != '' ORDER BY industry"),
      db.execute("SELECT DISTINCT vc_name FROM job_vc_backers ORDER BY vc_name"),
      db.execute("SELECT DISTINCT company_size FROM jobs WHERE company_size IS NOT NULL AND company_size != '' ORDER BY company_size"),
      db.execute("SELECT DISTINCT location FROM jobs WHERE location IS NOT NULL AND location != '' ORDER BY location LIMIT 200"),
      db.execute("SELECT DISTINCT category FROM jobs WHERE category IS NOT NULL AND category != '' ORDER BY category"),
      db.execute("SELECT DISTINCT value FROM jobs, json_each(jobs.hiring_period) WHERE hiring_period IS NOT NULL ORDER BY value"),
      db.execute("SELECT DISTINCT value FROM jobs, json_each(jobs.education_level) WHERE education_level IS NOT NULL ORDER BY value"),
    ]);

  return {
    seniorities: seniorities.rows.map((r) => r.seniority as string),
    departments: departments.rows.map((r) => r.department as string),
    industries: industries.rows.map((r) => r.industry as string),
    vcs: vcs.rows.map((r) => r.vc_name as string),
    company_sizes: companySizes.rows.map((r) => r.company_size as string),
    locations: locations.rows.map((r) => r.location as string),
    categories: categories.rows.map((r) => r.category as string),
    hiring_periods: hiringPeriods.rows.map((r) => r.value as string),
    education_levels: educationLevels.rows.map((r) => r.value as string),
  };
}
