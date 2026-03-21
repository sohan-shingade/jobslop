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
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition-colors ${
          count > 0
            ? "border-indigo-500/50 bg-indigo-500/10 text-indigo-300"
            : "border-zinc-700 bg-zinc-800/50 text-zinc-400 hover:border-zinc-600 hover:text-zinc-300"
        }`}
      >
        {label}
        {count > 0 && (
          <span className="bg-indigo-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
            {count}
          </span>
        )}
        <svg className="w-3.5 h-3.5 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-64 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl z-50 overflow-hidden">
          {options.length > 8 && (
            <div className="p-2 border-b border-zinc-800">
              <input
                type="text"
                placeholder="Search..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-sm text-zinc-300 placeholder-zinc-500 focus:outline-none focus:border-zinc-600"
                autoFocus
              />
            </div>
          )}
          <div className="max-h-64 overflow-y-auto p-1">
            {filtered.length === 0 && (
              <div className="px-3 py-2 text-sm text-zinc-500">No matches</div>
            )}
            {filtered.map((opt) => (
              <label
                key={opt}
                className="flex items-center gap-2.5 px-3 py-1.5 rounded hover:bg-zinc-800 cursor-pointer text-sm"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(opt)}
                  onChange={() => toggle(opt)}
                  className="rounded border-zinc-600 bg-zinc-800 text-indigo-500 focus:ring-indigo-500 focus:ring-offset-0"
                />
                <span className="text-zinc-300 truncate">{opt}</span>
              </label>
            ))}
          </div>
          {count > 0 && (
            <div className="border-t border-zinc-800 p-2">
              <button
                onClick={() => onChange([])}
                className="w-full text-xs text-zinc-500 hover:text-zinc-300 py-1"
              >
                Clear all
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
