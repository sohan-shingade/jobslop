import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";

// Rate limiting: 10 requests per IP per 24h
const rateMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 10;
const RATE_WINDOW = 24 * 60 * 60 * 1000;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count++;
  return true;
}

// Scoring helpers
const SENIORITY_LEVELS = ["intern", "junior", "mid", "senior", "staff", "lead", "principal", "director", "vp"];

function seniorityScore(jobSeniority: string | null, targetSeniority: string): number {
  if (!jobSeniority) return 0;
  const normalize = (s: string) => {
    const l = s.toLowerCase();
    if (l.includes("intern")) return "intern";
    if (l.includes("junior") || l.includes("entry")) return "junior";
    if (l.includes("mid")) return "mid";
    if (l.includes("senior") || l.includes("sr")) return "senior";
    if (l.includes("staff")) return "staff";
    if (l.includes("lead")) return "lead";
    if (l.includes("principal")) return "principal";
    if (l.includes("director")) return "director";
    if (l.includes("vp") || l.includes("vice president")) return "vp";
    if (l.includes("manager")) return "senior";
    return l;
  };
  const a = SENIORITY_LEVELS.indexOf(normalize(jobSeniority));
  const b = SENIORITY_LEVELS.indexOf(normalize(targetSeniority));
  if (a === -1 || b === -1) return 0;
  const dist = Math.abs(a - b);
  if (dist === 0) return 1;
  if (dist === 1) return 0.5;
  return 0;
}

function titleScore(jobTitle: string, targetRoles: string[]): number {
  const jWords = new Set(jobTitle.toLowerCase().split(/\W+/).filter(w => w.length > 2));
  let best = 0;
  for (const role of targetRoles) {
    const rWords = role.toLowerCase().split(/\W+/).filter(w => w.length > 2);
    if (rWords.length === 0) continue;
    const overlap = rWords.filter(w => jWords.has(w)).length;
    const score = overlap / rWords.length;
    if (score > best) best = score;
  }
  return best;
}

function skillScore(jobSkillsJson: string | null, profileSkills: string[]): number {
  if (!jobSkillsJson || profileSkills.length === 0) return 0;
  let jobSkills: string[];
  try {
    jobSkills = JSON.parse(jobSkillsJson);
    if (!Array.isArray(jobSkills)) return 0;
  } catch {
    return 0;
  }
  const jobSet = new Set(jobSkills.map(s => s.toLowerCase()));
  const matches = profileSkills.filter(s => jobSet.has(s.toLowerCase())).length;
  return matches / profileSkills.length;
}

function industryScore(jobIndustry: string | null, targetIndustries: string[]): number {
  if (!jobIndustry || targetIndustries.length === 0) return 0;
  const jLower = jobIndustry.toLowerCase();
  return targetIndustries.some(i => jLower.includes(i.toLowerCase()) || i.toLowerCase().includes(jLower)) ? 1 : 0;
}

interface Profile {
  target_roles: string[];
  skills: string[];
  seniority: string;
  industries: string[];
  keywords: string[];
  location_preference: string | null;
}

interface ScoredJob {
  id: string;
  score: number;
  reasons: string[];
}

export async function POST(request: NextRequest) {
  // Rate limit
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Try again tomorrow." },
      { status: 429 }
    );
  }

  let body: { text: string; intent: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { text, intent } = body;
  if (!text || text.length < 50) {
    return NextResponse.json({ error: "Resume text too short. Is the PDF readable?" }, { status: 400 });
  }
  if (text.length > 100_000) {
    return NextResponse.json({ error: "Resume text too large" }, { status: 400 });
  }

  // Extract profile with Claude
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Resume matching is not configured" }, { status: 503 });
  }

  let profile: Profile;
  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: `Analyze this resume and job search intent. Return ONLY valid JSON, no other text.

RESUME:
${text.slice(0, 15000)}

JOB SEARCH INTENT:
${intent || "Looking for relevant roles matching my background"}

Return JSON in this exact format:
{
  "target_roles": ["3-6 specific job titles the candidate should target, informed by BOTH their resume skills AND their stated intent"],
  "skills": ["list of technical and domain skills from the resume"],
  "seniority": "one of: intern, junior, mid, senior, staff, lead",
  "industries": ["2-4 target industries, weighted toward the user's stated intent"],
  "keywords": ["5-10 additional search keywords combining resume expertise and intent"],
  "location_preference": "location if mentioned in intent, otherwise null"
}`,
        },
      ],
    });

    const content = response.content[0];
    if (content.type !== "text") throw new Error("Unexpected response type");
    const jsonMatch = content.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON in response");
    profile = JSON.parse(jsonMatch[0]);
  } catch (e: unknown) {
    console.error("Claude API error:", e);
    // Surface specific API errors to the user
    const err = e as { status?: number; message?: string; error?: { message?: string; type?: string } };
    if (err.status === 401) {
      return NextResponse.json({ error: "API key is invalid or expired" }, { status: 500 });
    }
    if (err.status === 429) {
      return NextResponse.json({ error: "Claude API rate limit exceeded. Please try again in a minute." }, { status: 429 });
    }
    if (err.status === 403) {
      return NextResponse.json({ error: "API key does not have permission. Check billing/usage limits." }, { status: 500 });
    }
    if (err.status === 529) {
      return NextResponse.json({ error: "Claude is temporarily overloaded. Please try again shortly." }, { status: 503 });
    }
    const msg = err.error?.message || err.message || "Failed to analyze resume";
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  // Fetch recent jobs from DB
  const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const result = await db.execute({
    sql: `SELECT j.id, j.title, j.company, j.location, j.remote, j.seniority, j.skills, j.industry, j.salary_min, j.salary_max, j.salary_currency, j.posted_date, j.url, j.category, j.department, j.company_size, j.company_domain, j.hybrid, j.salary_period, j.source_platform, j.company_slug,
          GROUP_CONCAT(DISTINCT b.vc_name) as vc_backers
          FROM jobs j
          LEFT JOIN job_vc_backers b ON j.id = b.job_id
          WHERE j.posted_date >= ?
          GROUP BY j.id
          ORDER BY j.posted_date DESC`,
    args: [cutoff],
  });

  // Score each job
  const scored: ScoredJob[] = [];
  for (const row of result.rows) {
    const reasons: string[] = [];

    const tScore = titleScore(row.title as string, profile.target_roles);
    if (tScore > 0.3) reasons.push("title match");

    const skScore = skillScore(row.skills as string | null, profile.skills);
    if (skScore > 0) reasons.push(`${Math.round(skScore * profile.skills.length)}/${profile.skills.length} skills`);

    const senScore = seniorityScore(row.seniority as string | null, profile.seniority);
    if (senScore > 0) reasons.push("seniority match");

    const indScore = industryScore(row.industry as string | null, profile.industries);
    if (indScore > 0) reasons.push("industry match");

    // Also boost for keyword matches in title
    const titleLower = (row.title as string).toLowerCase();
    const kwMatches = profile.keywords.filter(kw => titleLower.includes(kw.toLowerCase())).length;
    const kwScore = profile.keywords.length > 0 ? kwMatches / profile.keywords.length : 0;
    if (kwMatches > 0) reasons.push(`${kwMatches} keyword${kwMatches > 1 ? "s" : ""}`);

    const totalScore = Math.round(
      (tScore * 35 + skScore * 25 + senScore * 15 + indScore * 15 + kwScore * 10)
    );

    if (totalScore >= 10 && reasons.length > 0) {
      scored.push({ id: row.id as string, score: totalScore, reasons });
    }
  }

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // Return top 200
  const topJobs = scored.slice(0, 200);
  const jobIds = topJobs.map(j => j.id);

  // Fetch full job data for matched IDs
  let jobs: Record<string, unknown>[] = [];
  if (jobIds.length > 0) {
    const placeholders = jobIds.map(() => "?").join(",");
    const fullResult = await db.execute({
      sql: `SELECT j.*, GROUP_CONCAT(DISTINCT b.vc_name) as vc_backers
            FROM jobs j
            LEFT JOIN job_vc_backers b ON j.id = b.job_id
            WHERE j.id IN (${placeholders})
            GROUP BY j.id`,
      args: jobIds,
    });
    // Map to objects
    const jobMap = new Map<string, Record<string, unknown>>();
    for (const row of fullResult.rows) {
      const obj: Record<string, unknown> = {};
      for (const col of fullResult.columns) {
        obj[col] = row[col as keyof typeof row];
      }
      obj.vc_backers = row.vc_backers ? (row.vc_backers as string).split(",") : [];
      obj.remote = (row.remote as number) === 1;
      obj.hybrid = (row.hybrid as number) === 1;
      jobMap.set(row.id as string, obj);
    }
    // Maintain score order
    for (const sj of topJobs) {
      const job = jobMap.get(sj.id);
      if (job) {
        jobs.push({ ...job, match_score: sj.score, match_reasons: sj.reasons });
      }
    }
  }

  return NextResponse.json({
    profile,
    jobs,
    total: scored.length,
  });
}
