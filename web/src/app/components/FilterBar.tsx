"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState, useEffect, useTransition } from "react";
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
      }
    }, 300);
    return () => clearTimeout(timeout);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const setArrayParam = (key: string, values: string[]) => {
    updateParams({ [key]: values.length > 0 ? values.join(",") : null });
  };

  const isRemote = getParam("remote") === "true";

  const chips: { key: string; label: string; value: string }[] = [];
  for (const [key, label] of [
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

  const removeChip = (key: string, value: string) => {
    if (key === "remote") {
      updateParams({ remote: null });
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
