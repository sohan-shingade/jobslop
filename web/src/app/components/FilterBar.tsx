"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState, useEffect, useTransition } from "react";
import { track } from "@vercel/analytics";
import FilterDropdown from "./FilterDropdown";
import type { FilterOptions, SortField, SortDir } from "@/lib/types";

interface FilterBarProps {
  filterOptions: FilterOptions;
  total: number;
}

const SORT_OPTIONS: { label: string; field: SortField; dir: SortDir }[] = [
  { label: "Newest first", field: "posted_date", dir: "desc" },
  { label: "Oldest first", field: "posted_date", dir: "asc" },
  { label: "Highest salary", field: "salary_max", dir: "desc" },
  { label: "Lowest salary", field: "salary_max", dir: "asc" },
  { label: "Company A\u2013Z", field: "company", dir: "asc" },
];

export default function FilterBar({ filterOptions, total }: FilterBarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const getParam = (key: string) => searchParams.get(key) || "";
  const getArrayParam = (key: string) => {
    const val = searchParams.get(key);
    return val ? val.split(",") : [];
  };

  const [query, setQuery] = useState(getParam("q"));

  useEffect(() => {
    setQuery(getParam("q"));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const updateParams = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, val] of Object.entries(updates)) {
        if (val === null || val === "") {
          params.delete(key);
        } else {
          params.set(key, val);
        }
      }
      params.delete("page");
      startTransition(() => {
        router.push(`?${params.toString()}`, { scroll: false });
      });
    },
    [router, searchParams, startTransition]
  );

  useEffect(() => {
    const timeout = setTimeout(() => {
      const currentQ = searchParams.get("q") || "";
      if (query !== currentQ) {
        updateParams({ q: query || null });
        if (query) track("search", { query });
      }
    }, 300);
    return () => clearTimeout(timeout);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const setArrayParam = (key: string, values: string[]) => {
    updateParams({ [key]: values.length > 0 ? values.join(",") : null });
    if (values.length > 0) track("filter", { type: key, values: values.join(",") });
  };

  const isRemote = getParam("remote") === "true";
  const isUSOnly = getParam("location") === "us";
  const currentSource = getParam("source");

  const chips: { key: string; label: string; value: string }[] = [];
  for (const [key, label] of [
    ["hiring_period", "Period"],
    ["education_level", "Edu"],
    ["seniority", "Level"],
    ["department", "Dept"],
    ["industry", "Industry"],
    ["vc", "VC"],
    ["category", "Type"],
  ] as const) {
    for (const val of getArrayParam(key)) {
      chips.push({ key, label, value: val });
    }
  }
  if (isRemote) chips.push({ key: "remote", label: "Remote", value: "true" });
  if (isUSOnly) chips.push({ key: "location", label: "Location", value: "US only" });
  const daysVal = getParam("days");
  if (daysVal) chips.push({ key: "days", label: "Posted", value: `last ${daysVal}d` });
  if (currentSource === "vc") chips.push({ key: "source", label: "Source", value: "VC-backed" });
  if (currentSource === "simplify") chips.push({ key: "source", label: "Source", value: "SimplifyJobs" });

  const removeChip = (key: string, value: string) => {
    if (key === "remote") {
      updateParams({ remote: null });
      return;
    }
    if (key === "location") {
      updateParams({ location: null });
      return;
    }
    if (key === "days") {
      updateParams({ days: null });
      return;
    }
    if (key === "source") {
      updateParams({ source: null });
      return;
    }
    const current = getArrayParam(key);
    setArrayParam(key, current.filter((v: string) => v !== value));
  };

  const clearAll = () => {
    startTransition(() => {
      router.push("/", { scroll: false });
    });
    setQuery("");
  };

  const currentSort = getParam("sort") || "posted_date_desc";
  const hasFilters = chips.length > 0 || query.length > 0;

  return (
    <div className="sticky top-0 z-40 bg-[var(--bg)]/95 backdrop-blur-md border-b border-[var(--border)]">
      {/* Header row */}
      <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-4">
        <div className="flex items-baseline gap-2">
          <span className="text-[15px] font-semibold tracking-tight text-[var(--text-primary)]">
            jobslop
          </span>
          <span className="text-[11px] font-[family-name:var(--font-geist-mono)] text-[var(--text-tertiary)] tabular-nums">
            {total.toLocaleString()}{isPending ? "..." : ""}
          </span>
        </div>

        <div className="relative flex-1 max-w-sm">
          <svg
            className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-tertiary)]"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search roles, companies..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 bg-transparent border border-[var(--border)] rounded-md text-[13px] text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:outline-none focus:border-[var(--text-secondary)] transition-colors duration-100"
          />
        </div>

        {/* Sort */}
        <select
          value={currentSort}
          onChange={(e) => updateParams({ sort: e.target.value })}
          className="hidden sm:block px-2 py-1.5 rounded-md text-[12px] border border-[var(--border)] bg-transparent text-[var(--text-secondary)] focus:outline-none cursor-pointer"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={`${o.field}_${o.dir}`} value={`${o.field}_${o.dir}`}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {/* Filters row */}
      <div className="max-w-7xl mx-auto px-4 pb-2.5 flex items-center gap-1.5 flex-wrap">
        <FilterDropdown
          label="Hiring Period"
          options={filterOptions.hiring_periods}
          selected={getArrayParam("hiring_period")}
          onChange={(v) => setArrayParam("hiring_period", v)}
        />
        <FilterDropdown
          label="Education"
          options={filterOptions.education_levels}
          selected={getArrayParam("education_level")}
          onChange={(v) => setArrayParam("education_level", v)}
        />
        <FilterDropdown
          label="Seniority"
          options={filterOptions.seniorities}
          selected={getArrayParam("seniority")}
          onChange={(v) => setArrayParam("seniority", v)}
        />
        <button
          onClick={() => updateParams({ remote: isRemote ? null : "true" })}
          className={`px-2.5 py-1 rounded-md text-[12px] border transition-colors duration-100 ${
            isRemote
              ? "border-emerald-500/30 text-emerald-400/90 bg-emerald-500/10"
              : "border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--text-tertiary)]"
          }`}
        >
          Remote
        </button>
        <button
          onClick={() => updateParams({ location: isUSOnly ? null : "us" })}
          className={`px-2.5 py-1 rounded-md text-[12px] border transition-colors duration-100 ${
            isUSOnly
              ? "border-sky-500/30 text-sky-400/90 bg-sky-500/10"
              : "border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--text-tertiary)]"
          }`}
        >
          US Only
        </button>
        <select
          value={getParam("days") || ""}
          onChange={(e) => updateParams({ days: e.target.value || null })}
          className={`px-2.5 py-1 rounded-md text-[12px] border transition-colors duration-100 cursor-pointer ${
            getParam("days")
              ? "border-[var(--accent)]/30 bg-[var(--accent-muted)] text-[var(--accent)]"
              : "border-[var(--border)] bg-transparent text-[var(--text-secondary)]"
          }`}
        >
          <option value="">Any time</option>
          <option value="1">Last 24h</option>
          <option value="3">Last 3 days</option>
          <option value="7">Last 7 days</option>
          <option value="14">Last 14 days</option>
          <option value="30">Last 30 days</option>
        </select>
        <select
          value={currentSource || ""}
          onChange={(e) => updateParams({ source: e.target.value || null })}
          className={`px-2.5 py-1 rounded-md text-[12px] border transition-colors duration-100 cursor-pointer ${
            currentSource
              ? "border-violet-500/30 bg-violet-500/10 text-violet-400/90"
              : "border-[var(--border)] bg-transparent text-[var(--text-secondary)]"
          }`}
        >
          <option value="">All sources</option>
          <option value="vc">VC-backed only</option>
          <option value="simplify">SimplifyJobs</option>
        </select>
        <FilterDropdown
          label="Department"
          options={filterOptions.departments}
          selected={getArrayParam("department")}
          onChange={(v) => setArrayParam("department", v)}
        />
        <FilterDropdown
          label="Industry"
          options={filterOptions.industries}
          selected={getArrayParam("industry")}
          onChange={(v) => setArrayParam("industry", v)}
        />
        <FilterDropdown
          label="VC Backer"
          options={filterOptions.vcs}
          selected={getArrayParam("vc")}
          onChange={(v) => setArrayParam("vc", v)}
        />
        <FilterDropdown
          label="Category"
          options={filterOptions.categories}
          selected={getArrayParam("category")}
          onChange={(v) => setArrayParam("category", v)}
        />

        {hasFilters && (
          <button
            onClick={clearAll}
            className="text-[11px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] ml-1 transition-colors duration-100"
          >
            Reset
          </button>
        )}
      </div>

      {/* Active chips */}
      {chips.length > 0 && (
        <div className="max-w-7xl mx-auto px-4 pb-2.5 flex items-center gap-1.5 flex-wrap">
          {chips.map((chip) => (
            <span
              key={`${chip.key}-${chip.value}`}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-[var(--bg-raised)] text-[var(--text-secondary)] border border-[var(--border-subtle)]"
            >
              <span className="text-[var(--text-tertiary)]">{chip.label}:</span>
              {chip.value === "true" ? "Yes" : chip.value}
              <button
                onClick={() => removeChip(chip.key, chip.value)}
                className="ml-0.5 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
              >
                &times;
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
