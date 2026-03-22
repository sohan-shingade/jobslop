"use client";

import { useState, useEffect, useCallback, useRef } from "react";
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

function saveResumeData(data: { text: string; intent: string }) {
  try { sessionStorage.setItem("jobslop_resume", JSON.stringify(data)); } catch {}
}
function loadResumeData(): { text: string; intent: string } | null {
  try {
    const raw = sessionStorage.getItem("jobslop_resume");
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function clearResumeData() {
  sessionStorage.removeItem("jobslop_resume");
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
  const [isRefetching, setIsRefetching] = useState(false);
  const searchParams = useSearchParams();
  const prevParamsRef = useRef(searchParams.toString());

  const isMatching = matchedJobs !== null;

  // When filters change while resume matching is active, re-fetch with new filters
  useEffect(() => {
    const currentParams = searchParams.toString();
    if (currentParams === prevParamsRef.current) return;
    prevParamsRef.current = currentParams;

    if (!isMatching) return;
    const resumeData = loadResumeData();
    if (!resumeData) return;

    // Re-run resume match with updated filters
    setIsRefetching(true);
    const filters: Record<string, string> = {};
    searchParams.forEach((value, key) => {
      if (key !== "page" && key !== "sort") filters[key] = value;
    });

    fetch("/api/resume-analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...resumeData, filters }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.jobs) {
          setMatchedJobs(data.jobs);
          setMatchTotal(data.total);
        }
      })
      .catch(console.error)
      .finally(() => setIsRefetching(false));
  }, [searchParams, isMatching]);

  const handleMatchResults = useCallback((newJobs: MatchedJob[], newTotal: number, resumeText?: string, intent?: string) => {
    setMatchedJobs(newJobs);
    setMatchTotal(newTotal);
    if (resumeText) saveResumeData({ text: resumeText, intent: intent || "" });
  }, []);

  const handleClear = useCallback(() => {
    setMatchedJobs(null);
    setMatchTotal(0);
    clearResumeData();
  }, []);

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
      {isRefetching && (
        <div className="max-w-7xl mx-auto px-4 py-1">
          <div className="text-[11px] text-[var(--accent)]">Updating matches...</div>
        </div>
      )}
      <main className="max-w-7xl mx-auto w-full flex-1">
        <JobTable jobs={displayJobs} sort={sort} dir={dir} showMatch={isMatching} />
        {!isMatching && (
          <Pagination total={total} page={page} pageSize={pageSize} />
        )}
        {isMatching && (
          <div className="flex flex-col items-center gap-1 py-10">
            <div className="text-[12px] font-[family-name:var(--font-geist-mono)] text-[var(--text-tertiary)] tabular-nums">
              {displayTotal} matches
            </div>
          </div>
        )}
      </main>
    </>
  );
}
