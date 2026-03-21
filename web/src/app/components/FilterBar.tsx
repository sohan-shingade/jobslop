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
  { label: "Newest", field: "posted_date", dir: "desc" },
  { label: "Oldest", field: "posted_date", dir: "asc" },
  { label: "Salary (high)", field: "salary_max", dir: "desc" },
  { label: "Salary (low)", field: "salary_max", dir: "asc" },
  { label: "Company A-Z", field: "company", dir: "asc" },
];

export default function FilterBar({ filterOptions, total }: FilterBarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const getParam = (key: string) => searchParams.get(key) || "";
  const getArrayParam = (key: string) => {
    const val = searchParams.get(key);
    return val ? val.split(",") : [];
  };

  const [query, setQuery] = useState(getParam("q"));

  // Sync query from URL on navigation
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
      // Reset to page 1 when filters change
      params.delete("page");
      startTransition(() => {
        router.push(`?${params.toString()}`, { scroll: false });
      });
    },
    [router, searchParams, startTransition]
  );

  // Debounced search
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

  // Collect active filter chips
  const chips: { key: string; label: string; value: string }[] = [];
  for (const [key, label] of [
    ["seniority", "Seniority"],
    ["department", "Dept"],
    ["industry", "Industry"],
    ["vc", "VC"],
    ["category", "Category"],
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
    setArrayParam(key, current.filter((v) => v !== value));
  };

  const clearAll = () => {
    startTransition(() => {
      router.push("/", { scroll: false });
    });
    setQuery("");
  };

  const currentSort = getParam("sort") || "posted_date_desc";

  return (
    <div className="sticky top-0 z-40 bg-zinc-950/95 backdrop-blur-sm border-b border-zinc-800">
      {/* Search + count row */}
      <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-4">
        <div className="text-lg font-semibold text-zinc-100 tracking-tight whitespace-nowrap">
          jobslop
        </div>
        <div className="relative flex-1 max-w-md">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            type="text"
            placeholder="Search roles, companies..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-500 transition-colors"
          />
        </div>
        <div className="text-sm text-zinc-500 whitespace-nowrap">
          {total.toLocaleString()} jobs
        </div>
      </div>

      {/* Filters row */}
      <div className="max-w-7xl mx-auto px-4 pb-3 flex items-center gap-2 flex-wrap">
        <FilterDropdown
          label="Seniority"
          options={filterOptions.seniorities}
          selected={getArrayParam("seniority")}
          onChange={(v) => setArrayParam("seniority", v)}
        />
        <button
          onClick={() => updateParams({ remote: isRemote ? null : "true" })}
          className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
            isRemote
              ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300"
              : "border-zinc-700 bg-zinc-800/50 text-zinc-400 hover:border-zinc-600 hover:text-zinc-300"
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

        {/* Sort */}
        <div className="ml-auto">
          <select
            value={currentSort}
            onChange={(e) => updateParams({ sort: e.target.value })}
            className="px-3 py-1.5 rounded-lg text-sm border border-zinc-700 bg-zinc-800/50 text-zinc-400 focus:outline-none focus:border-zinc-600 cursor-pointer"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={`${o.field}_${o.dir}`} value={`${o.field}_${o.dir}`}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Active filter chips */}
      {chips.length > 0 && (
        <div className="max-w-7xl mx-auto px-4 pb-3 flex items-center gap-2 flex-wrap">
          {chips.map((chip) => (
            <span
              key={`${chip.key}-${chip.value}`}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs bg-zinc-800 text-zinc-300 border border-zinc-700"
            >
              <span className="text-zinc-500">{chip.label}:</span> {chip.value}
              <button
                onClick={() => removeChip(chip.key, chip.value)}
                className="ml-0.5 text-zinc-500 hover:text-zinc-300"
              >
                &times;
              </button>
            </span>
          ))}
          <button
            onClick={clearAll}
            className="text-xs text-zinc-500 hover:text-zinc-300 ml-1"
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}
