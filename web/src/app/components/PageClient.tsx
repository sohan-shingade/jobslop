"use client";

import { useState, useMemo } from "react";
import { useSearchParams } from "next/navigation";
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
  const searchParams = useSearchParams();

  const isMatching = matchedJobs !== null;

  // Apply URL filters on top of matched results
  const filteredMatchedJobs = useMemo(() => {
    if (!matchedJobs) return null;

    let filtered = [...matchedJobs];
    const q = searchParams.get("q")?.toLowerCase();
    const seniority = searchParams.get("seniority")?.split(",");
    const remote = searchParams.get("remote") === "true";
    const department = searchParams.get("department")?.split(",");
    const industry = searchParams.get("industry")?.split(",");
    const vc = searchParams.get("vc")?.split(",");
    const category = searchParams.get("category")?.split(",");
    const loc = searchParams.get("location");

    if (q) {
      filtered = filtered.filter(
        (j) => j.title.toLowerCase().includes(q) || j.company.toLowerCase().includes(q)
      );
    }
    if (remote) {
      filtered = filtered.filter((j) => j.remote);
    }
    if (seniority?.length) {
      filtered = filtered.filter((j) => j.seniority && seniority.some((s) => j.seniority!.toLowerCase().includes(s.toLowerCase())));
    }
    if (department?.length) {
      filtered = filtered.filter((j) => j.department && department.includes(j.department));
    }
    if (industry?.length) {
      filtered = filtered.filter((j) => j.industry && industry.includes(j.industry));
    }
    if (vc?.length) {
      filtered = filtered.filter((j) => j.vc_backers.some((b) => vc.includes(b)));
    }
    if (category?.length) {
      filtered = filtered.filter((j) => j.category && category.includes(j.category));
    }
    if (loc === "us") {
      filtered = filtered.filter((j) => {
        const l = (j.location || "").toLowerCase();
        return l.includes("usa") || l.includes("united states") || /,\s*[a-z]{2}$/i.test(l) || /,\s*[a-z]{2}\s*$/i.test(j.location || "") || l.includes(", us") || stateAbbrs.some((s) => l.includes(`, ${s}`));
      });
    }

    return filtered;
  }, [matchedJobs, searchParams]);

  const handleMatchResults = (jobs: MatchedJob[], total: number) => {
    setMatchedJobs(jobs);
    setMatchTotal(total);
  };

  const handleClear = () => {
    setMatchedJobs(null);
    setMatchTotal(0);
  };

  const displayJobs = isMatching ? (filteredMatchedJobs || []) : jobs;
  const displayTotal = isMatching ? (filteredMatchedJobs?.length || 0) : total;

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
              {displayTotal} of {matchTotal} matches shown
            </div>
          </div>
        )}
      </main>
    </>
  );
}

// US state abbreviations for location matching
const stateAbbrs = [
  "al","ak","az","ar","ca","co","ct","de","fl","ga","hi","id","il","in","ia",
  "ks","ky","la","me","md","ma","mi","mn","ms","mo","mt","ne","nv","nh","nj",
  "nm","ny","nc","nd","oh","ok","or","pa","ri","sc","sd","tn","tx","ut","vt",
  "va","wa","wv","wi","wy","dc",
];
