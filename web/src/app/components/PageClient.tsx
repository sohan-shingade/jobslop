"use client";

import { useState } from "react";
import type { Job, SortField, SortDir, FilterOptions } from "@/lib/types";
import FilterBar from "./FilterBar";
import JobTable from "./JobTable";
import Pagination from "./Pagination";
import ResumeBar from "./ResumeBar";
import type { MatchedJob } from "./ResumeBar";

interface PageClientProps {
  jobs: Job[];
  total: number;
  filterOptions: FilterOptions;
  sort: SortField;
  dir: SortDir;
  page: number;
  pageSize: number;
}

export default function PageClient({
  jobs,
  total,
  filterOptions,
  sort,
  dir,
  page,
  pageSize,
}: PageClientProps) {
  const [matchedJobs, setMatchedJobs] = useState<MatchedJob[] | null>(null);
  const [matchTotal, setMatchTotal] = useState(0);

  const isMatching = matchedJobs !== null;

  const handleMatchResults = (jobs: MatchedJob[], total: number) => {
    setMatchedJobs(jobs);
    setMatchTotal(total);
  };

  const handleClear = () => {
    setMatchedJobs(null);
    setMatchTotal(0);
  };

  const displayJobs = isMatching ? matchedJobs : jobs;
  const displayTotal = isMatching ? matchTotal : total;

  return (
    <>
      <FilterBar filterOptions={filterOptions} total={displayTotal} />
      <ResumeBar
        onMatchResults={handleMatchResults}
        onClear={handleClear}
        isMatching={isMatching}
      />
      <main className="max-w-7xl mx-auto w-full flex-1">
        <JobTable jobs={displayJobs} sort={sort} dir={dir} showMatch={isMatching} />
        {!isMatching && (
          <Pagination total={total} page={page} pageSize={pageSize} />
        )}
        {isMatching && (
          <div className="flex flex-col items-center gap-1 py-10">
            <div className="text-[12px] font-[family-name:var(--font-geist-mono)] text-[var(--text-tertiary)] tabular-nums">
              {matchedJobs.length} matches found
            </div>
          </div>
        )}
      </main>
    </>
  );
}
