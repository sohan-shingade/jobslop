import { NextRequest, NextResponse } from "next/server";
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

  let body: { text: string; intent: string; filters?: Record<string, string> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { text, intent, filters } = body;
  if (!text || text.length < 50) {
    return NextResponse.json({ error: "Resume text too short. Is the PDF readable?" }, { status: 400 });
  }
  if (text.length > 100_000) {
    return NextResponse.json({ error: "Resume text too large" }, { status: 400 });
  }

  // Extract profile with Groq (Llama 3.3 70B — free tier)
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) {
    return NextResponse.json({ error: "Resume matching is not configured (GROQ_API_KEY missing)" }, { status: 503 });
  }

  let profile: Profile;
  try {
    const groqResp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${groqKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          {
            role: "user",
            content: `Analyze this resume and job search intent. Return ONLY valid JSON, no other text.

RESUME:
${text.slice(0, 12000)}

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
        temperature: 0.1,
        max_tokens: 1024,
        response_format: { type: "json_object" },
      }),
    });

    if (!groqResp.ok) {
      const errData = await groqResp.json().catch(() => ({}));
      const errMsg = errData?.error?.message || `Groq API error (${groqResp.status})`;
      console.error("Groq API error:", errData);
      if (groqResp.status === 429) {
        return NextResponse.json({ error: "Rate limit exceeded. Please try again in a minute." }, { status: 429 });
      }
      return NextResponse.json({ error: errMsg }, { status: 500 });
    }

    const groqData = await groqResp.json();
    const responseText = groqData.choices?.[0]?.message?.content || "";
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON in model response");
    profile = JSON.parse(jsonMatch[0]);
  } catch (e: unknown) {
    console.error("Resume analysis error:", e);
    const msg = e instanceof Error ? e.message : "Failed to analyze resume";
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  // Build filtered query — apply user's active filters before scoring
  const whereClauses: string[] = [];
  const queryArgs: (string | number)[] = [];

  // Only recent jobs
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  whereClauses.push("j.posted_date >= ?");
  queryArgs.push(cutoff);

  if (filters) {
    if (filters.q) {
      whereClauses.push("(j.title LIKE ? OR j.company LIKE ?)");
      queryArgs.push(`%${filters.q}%`, `%${filters.q}%`);
    }
    if (filters.remote === "true") {
      whereClauses.push("j.remote = 1");
    }
    if (filters.seniority) {
      const vals = filters.seniority.split(",");
      const senClauses = vals.map(() => "j.seniority LIKE ?");
      whereClauses.push(`(${senClauses.join(" OR ")})`);
      vals.forEach((v) => queryArgs.push(`%${v}%`));
    }
    if (filters.department) {
      const vals = filters.department.split(",");
      whereClauses.push(`j.department IN (${vals.map(() => "?").join(",")})`);
      queryArgs.push(...vals);
    }
    if (filters.industry) {
      const vals = filters.industry.split(",");
      whereClauses.push(`j.industry IN (${vals.map(() => "?").join(",")})`);
      queryArgs.push(...vals);
    }
    if (filters.category) {
      const vals = filters.category.split(",");
      whereClauses.push(`j.category IN (${vals.map(() => "?").join(",")})`);
      queryArgs.push(...vals);
    }
    if (filters.vc) {
      const vals = filters.vc.split(",");
      whereClauses.push(`j.id IN (SELECT job_id FROM job_vc_backers WHERE vc_name IN (${vals.map(() => "?").join(",")}))`);
      queryArgs.push(...vals);
    }
    if (filters.location === "us") {
      whereClauses.push("(j.location LIKE '%USA%' OR j.location LIKE '%United States%' OR j.location LIKE '%, US%' OR j.location LIKE '%, CA%' OR j.location LIKE '%, NY%' OR j.location LIKE '%, TX%' OR j.location LIKE '%, WA%' OR j.location LIKE '%, MA%' OR j.location LIKE '%, IL%' OR j.location LIKE '%, CO%' OR j.location LIKE '%, GA%' OR j.location LIKE '%, PA%' OR j.location LIKE '%, FL%' OR j.location LIKE '%, VA%' OR j.location LIKE '%, NC%' OR j.location LIKE '%, OH%' OR j.location LIKE '%, OR%' OR j.location LIKE '%, DC%' OR j.location LIKE '%, AZ%' OR j.location LIKE '%, MD%' OR j.location LIKE '%, MN%' OR j.location LIKE '%, NJ%' OR j.location LIKE '%, CT%' OR j.location LIKE '%, UT%' OR j.location LIKE '%, MI%' OR j.location LIKE '%, TN%' OR j.location LIKE '%, MO%' OR j.location LIKE '%, IN%' OR j.location LIKE '%, WI%')");
    }
  }

  const whereStr = whereClauses.length > 0 ? "WHERE " + whereClauses.join(" AND ") : "";

  const result = await db.execute({
    sql: `SELECT j.id, j.title, j.company, j.location, j.remote, j.seniority, j.skills, j.industry, j.salary_min, j.salary_max, j.salary_currency, j.posted_date, j.url, j.category, j.department, j.company_size, j.company_domain, j.company_description, j.hybrid, j.salary_period, j.source_platform, j.company_slug,
          GROUP_CONCAT(DISTINCT b.vc_name) as vc_backers
          FROM jobs j
          LEFT JOIN job_vc_backers b ON j.id = b.job_id
          ${whereStr}
          GROUP BY j.id
          ORDER BY j.posted_date DESC`,
    args: queryArgs,
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
