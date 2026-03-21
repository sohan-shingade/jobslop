import type { Job, SortField, SortDir } from "@/lib/types";
import JobRow from "./JobRow";

interface JobTableProps {
  jobs: (Job & { match_score?: number; match_reasons?: string[] })[];
  sort: SortField;
  dir: SortDir;
  showMatch?: boolean;
}

function SortLink({
  field,
  label,
  currentSort,
  currentDir,
  className,
}: {
  field: SortField;
  label: string;
  currentSort: SortField;
  currentDir: SortDir;
  className?: string;
}) {
  const active = currentSort === field;
  const nextDir = active && currentDir === "desc" ? "asc" : "desc";
  const href = `?sort=${field}_${nextDir}`;
  const arrow = active ? (currentDir === "asc" ? " \u2191" : " \u2193") : "";

  return (
    <a
      href={href}
      className={`hover:text-[var(--text-primary)] transition-colors duration-100 ${
        active ? "text-[var(--accent)]" : ""
      } ${className || ""}`}
    >
      {label}{arrow}
    </a>
  );
}

export default function JobTable({ jobs, sort, dir, showMatch }: JobTableProps) {
  if (jobs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-2">
        <div className="text-[var(--text-tertiary)] text-sm">No jobs match your filters</div>
        <div className="text-[var(--text-tertiary)] text-xs">Try broadening your search</div>
      </div>
    );
  }

  return (
    <div className="w-full">
      {/* Column headers */}
      <div className="flex items-center gap-3 px-4 py-1.5 text-[10px] text-[var(--text-tertiary)] uppercase tracking-widest border-b border-[var(--border)] bg-[var(--bg)]">
        {showMatch && <div className="w-10 shrink-0 text-right">Match</div>}
        <div className="w-7 shrink-0" />
        <div className="flex-1">
          <SortLink field="posted_date" label="Role" currentSort={sort} currentDir={dir} />
        </div>
        <div className="hidden md:block w-36 text-right">Location</div>
        <div className="hidden lg:block w-20 text-right">Level</div>
        <div className="hidden lg:block w-24 text-right">
          <SortLink field="salary_max" label="Salary" currentSort={sort} currentDir={dir} />
        </div>
        <div className="w-10 text-right">Age</div>
      </div>

      {jobs.map((job) => (
        <JobRow key={job.id} job={job} showMatch={showMatch} />
      ))}
    </div>
  );
}
