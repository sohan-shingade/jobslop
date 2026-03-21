import type { Job, SortField, SortDir } from "@/lib/types";
import JobRow from "./JobRow";

interface JobTableProps {
  jobs: Job[];
  sort: SortField;
  dir: SortDir;
}

function SortArrow({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <span className="text-zinc-700 ml-1">↕</span>;
  return <span className="text-indigo-400 ml-1">{dir === "asc" ? "↑" : "↓"}</span>;
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

  return (
    <a href={href} className={`hover:text-zinc-300 transition-colors ${className || ""}`}>
      {label}
      <SortArrow active={active} dir={currentDir} />
    </a>
  );
}

export default function JobTable({ jobs, sort, dir }: JobTableProps) {
  if (jobs.length === 0) {
    return (
      <div className="text-center py-20 text-zinc-500">
        <div className="text-4xl mb-3">🔍</div>
        <div className="text-lg">No jobs found</div>
        <div className="text-sm mt-1">Try adjusting your filters</div>
      </div>
    );
  }

  return (
    <div className="w-full">
      {/* Header */}
      <div className="grid grid-cols-[2.25rem_1fr_8rem_10rem_4.5rem_5.5rem_3rem] items-center gap-3 px-4 py-2 text-xs text-zinc-600 uppercase tracking-wider border-b border-zinc-800 sticky top-[calc(theme(spacing.0))] bg-zinc-950">
        <div></div>
        <SortLink field="posted_date" label="Role" currentSort={sort} currentDir={dir} />
        <SortLink field="company" label="Company" currentSort={sort} currentDir={dir} className="hidden md:block" />
        <div className="hidden md:block">Location</div>
        <div className="hidden md:block">Level</div>
        <SortLink field="salary_max" label="Salary" currentSort={sort} currentDir={dir} className="hidden lg:block text-right" />
        <div className="text-right">Age</div>
      </div>

      {/* Rows */}
      {jobs.map((job) => (
        <JobRow key={job.id} job={job} />
      ))}
    </div>
  );
}
