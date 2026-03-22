import type { Job } from "@/lib/types";

function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const colors = [
    "#6366f1", "#f59e0b", "#06b6d4", "#10b981",
    "#ec4899", "#f97316", "#8b5cf6", "#84cc16",
  ];
  return colors[Math.abs(hash) % colors.length];
}

function formatAge(postedDate: string | null): string {
  if (!postedDate) return "—";
  const now = new Date();
  const posted = new Date(postedDate);
  const days = Math.floor((now.getTime() - posted.getTime()) / (1000 * 60 * 60 * 24));
  if (days < 0) return "new";
  if (days === 0) return "today";
  return `${days}d`;
}

function formatSalary(minCents: number | null, maxCents: number | null, currency: string | null): string {
  if (!minCents && !maxCents) return "";
  // Convert cents to dollars
  const min = minCents ? Math.round(minCents / 100) : null;
  const max = maxCents ? Math.round(maxCents / 100) : null;
  const fmt = (n: number) => {
    if (n >= 1000) return `${Math.round(n / 1000)}K`;
    return n.toString();
  };
  const c = currency || "USD";
  const sym = c === "USD" ? "$" : c === "EUR" ? "\u20AC" : c === "GBP" ? "\u00A3" : `${c} `;
  if (min && max) return `${sym}${fmt(min)}\u2013${fmt(max)}`;
  if (max) return `${sym}${fmt(max)}`;
  if (min) return `${sym}${fmt(min)}+`;
  return "";
}

function shortenSeniority(s: string): string {
  const lower = s.toLowerCase();
  if (lower.includes("intern")) return "Intern";
  if (lower.includes("entry") || lower.includes("junior")) return "Junior";
  if (lower.includes("staff")) return "Staff";
  if (lower.includes("principal")) return "Principal";
  if (lower.includes("lead")) return "Lead";
  if (lower.includes("director")) return "Director";
  if (lower.includes("vp") || lower.includes("vice president")) return "VP";
  if (lower.includes("senior") || lower.includes("sr")) return "Senior";
  if (lower.includes("manager")) return "Manager";
  if (lower.includes("mid")) return "Mid";
  // Truncate anything else
  return s.length > 10 ? s.slice(0, 9) + "\u2026" : s;
}

const seniorityStyle: Record<string, string> = {
  intern: "text-amber-400/90",
  junior: "text-lime-400/90",
  mid: "text-sky-400/90",
  senior: "text-[var(--accent)]",
  staff: "text-violet-400/90",
  lead: "text-pink-400/90",
  principal: "text-rose-400/90",
  manager: "text-orange-400/90",
  director: "text-red-400/90",
  vp: "text-red-300/90",
};

function getSeniorityStyle(label: string): string {
  const key = label.toLowerCase();
  for (const [k, v] of Object.entries(seniorityStyle)) {
    if (key.includes(k)) return v;
  }
  return "text-[var(--text-secondary)]";
}

export default function JobRow({ job, showMatch }: { job: Job & { match_score?: number; match_reasons?: string[] }; showMatch?: boolean }) {
  const initial = job.company.charAt(0).toUpperCase();
  const color = avatarColor(job.company);
  const age = formatAge(job.posted_date);
  const salary = formatSalary(job.salary_min, job.salary_max, job.salary_currency);
  const seniority = job.seniority ? shortenSeniority(job.seniority) : null;

  return (
    <a
      href={job.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex items-center gap-3 px-4 py-2 border-b border-[var(--border-subtle)] hover:bg-[var(--bg-hover)] transition-colors duration-100"
    >
      {/* Match score */}
      {showMatch && (
        <div className="w-10 shrink-0 text-right">
          {job.match_score != null && (
            <span className={`text-[12px] font-[family-name:var(--font-geist-mono)] tabular-nums ${
              job.match_score >= 70 ? "text-emerald-400" : job.match_score >= 40 ? "text-[var(--accent)]" : "text-[var(--text-tertiary)]"
            }`}>
              {job.match_score}%
            </span>
          )}
        </div>
      )}

      {/* Avatar */}
      <div
        className="w-7 h-7 rounded-md flex items-center justify-center text-white text-xs font-semibold shrink-0"
        style={{ backgroundColor: color }}
      >
        {initial}
      </div>

      {/* Title + meta */}
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium text-[var(--text-primary)] truncate group-hover:text-white transition-colors duration-100">
          {job.title}
        </div>
        <div className="text-[11px] text-[var(--text-tertiary)] truncate">
          <span className="text-[var(--text-secondary)]">{job.company}</span>
          {job.company_description ? (
            <span> — {job.company_description}{job.industry ? <span className="text-[var(--text-tertiary)]/50"> · {job.industry}</span> : null}</span>
          ) : (job.industry || job.company_size) ? (
            <span> · {[job.industry, job.company_size].filter(Boolean).join(" · ")}</span>
          ) : null}
        </div>
      </div>

      {/* Location */}
      <div className="hidden md:block w-36 text-[12px] text-[var(--text-secondary)] truncate text-right">
        {job.location || "—"}
        {job.remote && <span className="ml-1 text-emerald-500/70 text-[10px]">remote</span>}
      </div>

      {/* Seniority */}
      <div className="hidden lg:block w-20 text-right">
        {seniority && (
          <span className={`text-[11px] font-medium font-[family-name:var(--font-geist-mono)] ${getSeniorityStyle(seniority)}`}>
            {seniority}
          </span>
        )}
      </div>

      {/* Salary */}
      <div className="hidden lg:block w-24 text-right">
        {salary && (
          <span className="text-[12px] font-[family-name:var(--font-geist-mono)] text-emerald-400/70 tabular-nums">
            {salary}
          </span>
        )}
      </div>

      {/* Age */}
      <div className="w-10 text-right text-[11px] font-[family-name:var(--font-geist-mono)] text-[var(--text-tertiary)] tabular-nums">
        {age}
      </div>
    </a>
  );
}
