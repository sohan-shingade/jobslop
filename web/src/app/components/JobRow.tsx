import type { Job } from "@/lib/types";

// Generate a consistent color from company name
function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const colors = [
    "from-indigo-500 to-purple-600",
    "from-amber-500 to-red-500",
    "from-cyan-500 to-blue-600",
    "from-emerald-500 to-teal-600",
    "from-pink-500 to-rose-600",
    "from-orange-500 to-amber-600",
    "from-violet-500 to-indigo-600",
    "from-lime-500 to-green-600",
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
  if (days === 1) return "1d";
  if (days < 7) return `${days}d`;
  if (days < 14) return "1w";
  if (days < 30) return `${Math.floor(days / 7)}w`;
  if (days < 60) return "1mo";
  return `${Math.floor(days / 30)}mo`;
}

function formatSalary(min: number | null, max: number | null, currency: string | null): string {
  if (!min && !max) return "—";
  const fmt = (n: number) => {
    if (n >= 1000) return `${Math.round(n / 1000)}K`;
    return n.toString();
  };
  const c = currency || "USD";
  const symbol = c === "USD" ? "$" : c === "EUR" ? "€" : c === "GBP" ? "£" : `${c} `;
  if (min && max) return `${symbol}${fmt(min)}–${fmt(max)}`;
  if (max) return `${symbol}${fmt(max)}`;
  if (min) return `${symbol}${fmt(min)}+`;
  return "—";
}

const seniorityColors: Record<string, string> = {
  intern: "text-amber-400 bg-amber-400/10",
  junior: "text-green-400 bg-green-400/10",
  mid: "text-blue-400 bg-blue-400/10",
  senior: "text-indigo-400 bg-indigo-400/10",
  staff: "text-purple-400 bg-purple-400/10",
  lead: "text-pink-400 bg-pink-400/10",
  principal: "text-rose-400 bg-rose-400/10",
};

export default function JobRow({ job }: { job: Job }) {
  const initial = job.company.charAt(0).toUpperCase();
  const color = avatarColor(job.company);
  const age = formatAge(job.posted_date);
  const salary = formatSalary(job.salary_min, job.salary_max, job.salary_currency);
  const seniorityKey = job.seniority?.toLowerCase() || "";
  const seniorityClass = seniorityColors[seniorityKey] || "text-zinc-400 bg-zinc-400/10";

  return (
    <a
      href={job.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group grid grid-cols-[2.25rem_1fr_8rem_10rem_4.5rem_5.5rem_3rem] items-center gap-3 px-4 py-2.5 border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors"
    >
      {/* Avatar */}
      <div
        className={`w-9 h-9 rounded-lg bg-gradient-to-br ${color} flex items-center justify-center text-white text-sm font-bold shrink-0`}
      >
        {initial}
      </div>

      {/* Title + Company */}
      <div className="min-w-0">
        <div className="text-sm font-medium text-zinc-200 truncate group-hover:text-white transition-colors">
          {job.title}
        </div>
        <div className="text-xs text-zinc-500 truncate">
          {job.company}
          {job.vc_backers.length > 0 && (
            <span className="text-zinc-600"> · {job.vc_backers.join(", ")}</span>
          )}
        </div>
      </div>

      {/* Company (separate column for sorting) */}
      <div className="text-sm text-zinc-400 truncate hidden md:block">
        {job.company}
      </div>

      {/* Location */}
      <div className="text-sm text-zinc-500 truncate hidden md:block">
        {job.location || "—"}
        {job.remote && <span className="ml-1 text-emerald-500">&#x1F3E0;</span>}
      </div>

      {/* Seniority */}
      <div className="hidden md:block">
        {job.seniority && (
          <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${seniorityClass}`}>
            {job.seniority}
          </span>
        )}
      </div>

      {/* Salary */}
      <div className="text-sm text-emerald-400/80 text-right hidden lg:block">
        {salary}
      </div>

      {/* Age */}
      <div className="text-xs text-zinc-600 text-right">{age}</div>
    </a>
  );
}
