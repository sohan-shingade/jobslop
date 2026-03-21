"use client";

import { useState, useRef, useEffect } from "react";

interface FilterDropdownProps {
  label: string;
  options: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
}

export default function FilterDropdown({
  label,
  options,
  selected,
  onChange,
}: FilterDropdownProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const filtered = search
    ? options.filter((o) => o.toLowerCase().includes(search.toLowerCase()))
    : options;

  const toggle = (val: string) => {
    if (selected.includes(val)) {
      onChange(selected.filter((s) => s !== val));
    } else {
      onChange([...selected, val]);
    }
  };

  const count = selected.length;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] border transition-colors duration-100 ${
          count > 0
            ? "border-[var(--accent)]/30 bg-[var(--accent-muted)] text-[var(--accent)]"
            : "border-[var(--border)] bg-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--text-tertiary)]"
        }`}
      >
        {label}
        {count > 0 && (
          <span className="text-[10px] font-[family-name:var(--font-geist-mono)] opacity-80">
            {count}
          </span>
        )}
        <svg className="w-3 h-3 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-60 bg-[var(--bg-raised)] border border-[var(--border)] rounded-lg shadow-2xl shadow-black/50 z-50 overflow-hidden">
          {options.length > 8 && (
            <div className="p-2 border-b border-[var(--border-subtle)]">
              <input
                type="text"
                placeholder="Filter..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full px-2 py-1 bg-[var(--bg)] border border-[var(--border)] rounded text-[12px] text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:outline-none focus:border-[var(--text-secondary)]"
                autoFocus
              />
            </div>
          )}
          <div className="max-h-56 overflow-y-auto py-1">
            {filtered.length === 0 && (
              <div className="px-3 py-2 text-[12px] text-[var(--text-tertiary)]">No matches</div>
            )}
            {filtered.map((opt) => (
              <label
                key={opt}
                className="flex items-center gap-2 px-3 py-1 hover:bg-[var(--bg-hover)] cursor-pointer text-[12px]"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(opt)}
                  onChange={() => toggle(opt)}
                  className="rounded-sm border-[var(--border)] bg-[var(--bg)] text-[var(--accent)] focus:ring-[var(--accent)] focus:ring-offset-0 w-3.5 h-3.5"
                />
                <span className="text-[var(--text-primary)] truncate">{opt}</span>
              </label>
            ))}
          </div>
          {count > 0 && (
            <div className="border-t border-[var(--border-subtle)] px-3 py-1.5">
              <button
                onClick={() => onChange([])}
                className="text-[11px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
              >
                Clear
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
