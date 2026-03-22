import { Suspense } from "react";
import { fetchJobs, fetchFilterOptions } from "@/lib/queries";
import type { Filters, SortField, SortDir } from "@/lib/types";
import PageClient from "./components/PageClient";

const PAGE_SIZE = 50;

function parseFilters(
  params: Record<string, string | string[] | undefined>
): { filters: Filters; sort: SortField; dir: SortDir; page: number } {
  const filters: Filters = {};

  if (params.q) filters.q = String(params.q);
  if (params.remote === "true") filters.remote = true;
  if (params.seniority) filters.seniority = String(params.seniority).split(",");
  if (params.department) filters.department = String(params.department).split(",");
  if (params.industry) filters.industry = String(params.industry).split(",");
  if (params.vc) filters.vc = String(params.vc).split(",");
  if (params.category) filters.category = String(params.category).split(",");
  if (params.company_size)
    filters.company_size = String(params.company_size).split(",");
  if (params.location === "us") filters.us_only = true;
  if (params.days) filters.days = parseInt(String(params.days), 10);

  const sortParam = String(params.sort || "posted_date_desc");
  const lastUnderscore = sortParam.lastIndexOf("_");
  const sort = (sortParam.slice(0, lastUnderscore) || "posted_date") as SortField;
  const dir = (sortParam.slice(lastUnderscore + 1) || "desc") as SortDir;
  const page = Math.max(1, parseInt(String(params.page || "1"), 10));

  return { filters, sort, dir, page };
}

async function JobResults({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const { filters, sort, dir, page } = parseFilters(searchParams);

  const [{ jobs, total }, filterOptions] = await Promise.all([
    fetchJobs(filters, sort, dir, page),
    fetchFilterOptions(),
  ]);

  return (
    <PageClient
      jobs={jobs}
      total={total}
      filterOptions={filterOptions}
      sort={sort}
      dir={dir}
      page={page}
      pageSize={PAGE_SIZE}
    />
  );
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;

  return (
    <div className="flex flex-col min-h-screen">
      <Suspense
        fallback={
          <div className="flex items-center justify-center min-h-screen">
            <div className="text-[var(--text-tertiary)]">Loading jobs...</div>
          </div>
        }
      >
        <JobResults searchParams={params} />
      </Suspense>
    </div>
  );
}
