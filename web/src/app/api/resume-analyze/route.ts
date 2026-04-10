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

// ── Skill synonyms: map variations to a canonical form ──────────────
const SKILL_ALIASES: Record<string, string> = {
  js: "javascript", typescript: "javascript", ts: "javascript", node: "javascript", "node.js": "javascript", nodejs: "javascript",
  py: "python", python3: "python", "python 3": "python",
  react: "react", "react.js": "react", reactjs: "react", nextjs: "react", "next.js": "react",
  vue: "vue", "vue.js": "vue", vuejs: "vue", nuxt: "vue", "nuxt.js": "vue",
  angular: "angular", angularjs: "angular",
  postgres: "postgresql", psql: "postgresql", pg: "postgresql",
  mongo: "mongodb", mongoose: "mongodb",
  mysql: "sql", sqlite: "sql", "ms sql": "sql", mssql: "sql",
  aws: "aws", "amazon web services": "aws",
  gcp: "gcp", "google cloud": "gcp", "google cloud platform": "gcp",
  azure: "azure", "microsoft azure": "azure",
  k8s: "kubernetes", kube: "kubernetes",
  tf: "terraform",
  ml: "machine learning", "deep learning": "machine learning", dl: "machine learning",
  ai: "machine learning", "artificial intelligence": "machine learning",
  tensorflow: "tensorflow", tf2: "tensorflow",
  pytorch: "pytorch", torch: "pytorch",
  pandas: "pandas", numpy: "pandas",
  scikit: "scikit-learn", sklearn: "scikit-learn", "scikit learn": "scikit-learn",
  docker: "docker", containerization: "docker",
  ci: "ci/cd", cd: "ci/cd", "ci/cd": "ci/cd", jenkins: "ci/cd", "github actions": "ci/cd",
  graphql: "graphql", gql: "graphql",
  redis: "redis", memcached: "redis",
  kafka: "kafka", rabbitmq: "kafka",
  spark: "spark", pyspark: "spark",
  airflow: "airflow", dag: "airflow",
  java: "java", jvm: "java", kotlin: "java", scala: "java",
  go: "golang", golang: "golang",
  rust: "rust",
  cpp: "c++", "c++": "c++",
  c: "c",
  swift: "swift",
  ruby: "ruby", rails: "ruby", ror: "ruby",
  php: "php", laravel: "php",
  r: "r", rstudio: "r",
  tableau: "tableau", powerbi: "tableau", "power bi": "tableau", looker: "tableau",
  figma: "figma", sketch: "figma",
  solidity: "solidity", "smart contracts": "solidity",
  web3: "web3", blockchain: "web3", defi: "web3",
  css: "css", sass: "css", scss: "css", tailwind: "css", "tailwindcss": "css",
  html: "html",
  git: "git", github: "git", gitlab: "git",
  linux: "linux", unix: "linux", bash: "linux", shell: "linux",
  excel: "excel", "google sheets": "excel", spreadsheets: "excel",
  sql: "sql",
};

function canonicalSkill(s: string): string {
  const lower = s.toLowerCase().trim();
  return SKILL_ALIASES[lower] || lower;
}

function canonicalSkillSet(skills: string[]): Set<string> {
  const set = new Set<string>();
  for (const s of skills) {
    set.add(canonicalSkill(s));
    // Also add the raw lowercase so exact matches still work
    set.add(s.toLowerCase().trim());
  }
  return set;
}

// ── Title synonyms for semantic matching ────────────────────────────
const TITLE_SYNONYMS: Record<string, string[]> = {
  "software engineer": ["software developer", "swe", "backend engineer", "frontend engineer", "full stack engineer", "fullstack engineer", "full-stack engineer", "application developer", "web developer", "platform engineer"],
  "data scientist": ["data science", "ml scientist", "research scientist", "applied scientist"],
  "data engineer": ["data platform engineer", "analytics engineer", "etl developer", "data infrastructure"],
  "machine learning engineer": ["ml engineer", "mlops engineer", "ai engineer", "deep learning engineer"],
  "product manager": ["product owner", "pm", "program manager", "technical program manager", "tpm"],
  "designer": ["ux designer", "ui designer", "product designer", "ux/ui designer", "ui/ux designer", "visual designer", "interaction designer"],
  "devops engineer": ["site reliability engineer", "sre", "infrastructure engineer", "platform engineer", "cloud engineer"],
  "data analyst": ["business analyst", "analytics", "bi analyst", "business intelligence"],
  "security engineer": ["cybersecurity engineer", "infosec engineer", "application security", "security analyst"],
  "qa engineer": ["quality assurance", "test engineer", "sdet", "qa analyst", "automation engineer"],
  "quant": ["quantitative researcher", "quantitative analyst", "quantitative developer", "quant researcher", "quant developer", "quant analyst"],
};

// ── Seniority scoring ───────────────────────────────────────────────
const SENIORITY_LEVELS = ["intern", "junior", "mid", "senior", "staff", "lead", "principal", "director", "vp"];

function normalizeSeniority(s: string): string {
  const l = s.toLowerCase();
  if (l.includes("intern") || l.includes("co-op") || l.includes("coop")) return "intern";
  if (l.includes("junior") || l.includes("entry") || l.includes("associate") || l.includes("new grad") || l.includes("early career")) return "junior";
  if (l.includes("mid") || l.includes("intermediate")) return "mid";
  if (l.includes("senior") || l.includes("sr.") || l.includes("sr ")) return "senior";
  if (l.includes("staff") || l.includes("principal")) return "staff";
  if (l.includes("lead") || l.includes("manager")) return "lead";
  if (l.includes("director")) return "director";
  if (l.includes("vp") || l.includes("vice president")) return "vp";
  return l;
}

function seniorityScore(jobSeniority: string | null, targetSeniority: string): number {
  if (!jobSeniority) return 0.3; // Unknown seniority = partial credit, don't penalize
  const a = SENIORITY_LEVELS.indexOf(normalizeSeniority(jobSeniority));
  const b = SENIORITY_LEVELS.indexOf(normalizeSeniority(targetSeniority));
  if (a === -1 || b === -1) return 0.3;
  const dist = Math.abs(a - b);
  if (dist === 0) return 1;
  if (dist === 1) return 0.6;
  return 0;
}

// ── Infer seniority from job title when DB field is null ────────────
function inferSeniority(title: string): string | null {
  const l = title.toLowerCase();
  if (/\bintern\b|\bco-?op\b/.test(l)) return "intern";
  if (/\bjunior\b|\bjr\.?\b|\bentry[- ]level\b|\bassociate\b|\bnew grad\b/.test(l)) return "junior";
  if (/\bsenior\b|\bsr\.?\b/.test(l)) return "senior";
  if (/\bstaff\b/.test(l)) return "staff";
  if (/\bprincipal\b/.test(l)) return "principal";
  if (/\blead\b/.test(l)) return "lead";
  if (/\bdirector\b/.test(l)) return "director";
  if (/\bvp\b|\bvice president\b/.test(l)) return "vp";
  return null;
}

// ── Title scoring with synonym expansion ────────────────────────────
function titleScore(jobTitle: string, targetRoles: string[]): number {
  const jLower = jobTitle.toLowerCase();
  const jWords = new Set(jLower.split(/\W+/).filter(w => w.length > 1));

  let best = 0;
  for (const role of targetRoles) {
    // Direct substring check — "ML Engineer" in "Senior ML Engineer"
    if (jLower.includes(role.toLowerCase())) {
      best = Math.max(best, 1.0);
      continue;
    }

    // Check if the job title matches any synonym of the target role
    const roleLower = role.toLowerCase();
    for (const [canonical, synonyms] of Object.entries(TITLE_SYNONYMS)) {
      const allVariants = [canonical, ...synonyms];
      const roleMatchesGroup = allVariants.some(v => roleLower.includes(v) || v.includes(roleLower));
      if (roleMatchesGroup) {
        const jobMatchesGroup = allVariants.some(v => jLower.includes(v));
        if (jobMatchesGroup) {
          best = Math.max(best, 0.85);
          break;
        }
      }
    }

    // Word overlap fallback
    const rWords = role.toLowerCase().split(/\W+/).filter(w => w.length > 1);
    if (rWords.length === 0) continue;
    const overlap = rWords.filter(w => jWords.has(w)).length;
    const score = overlap / rWords.length;
    if (score > best) best = score;
  }
  return best;
}

// ── Skill scoring with bidirectional matching ──────────────────────
// Returns both a blended score and a raw match count.
// "forward" = what fraction of YOUR skills the job mentions (relevance to you)
// "reverse" = what fraction of the JOB's skills you have (how qualified you are)
// Blending both means a React dev and a Python dev score very differently on the same job.
function skillScore(
  jobSkillsJson: string | null,
  profileSkillsCanonical: Set<string>
): { score: number; matchCount: number } {
  if (profileSkillsCanonical.size === 0) return { score: 0, matchCount: 0 };
  if (!jobSkillsJson) return { score: 0, matchCount: 0 };
  let jobSkills: string[];
  try {
    jobSkills = JSON.parse(jobSkillsJson);
    if (!Array.isArray(jobSkills)) return { score: 0, matchCount: 0 };
  } catch {
    return { score: 0, matchCount: 0 };
  }
  if (jobSkills.length === 0) return { score: 0, matchCount: 0 };
  const jobCanonical = canonicalSkillSet(jobSkills);
  let matches = 0;
  for (const sk of profileSkillsCanonical) {
    if (jobCanonical.has(sk)) matches++;
  }
  const forward = matches / profileSkillsCanonical.size;  // how relevant to you
  const reverse = matches / jobCanonical.size;             // how qualified you are
  // Blend: 40% forward + 60% reverse — reverse matters more because it differentiates
  // A frontend dev matching 5/5 job skills scores way higher than matching 5/20 job skills
  const score = forward * 0.4 + reverse * 0.6;
  return { score, matchCount: matches };
}

// Same bidirectional logic for title-extracted skill sets (jobs without skills field)
function skillScoreFromSet(
  jobSkills: Set<string>,
  profileSkillsCanonical: Set<string>
): { score: number; matchCount: number } {
  if (profileSkillsCanonical.size === 0 || jobSkills.size === 0) return { score: 0, matchCount: 0 };
  let matches = 0;
  for (const sk of profileSkillsCanonical) {
    if (jobSkills.has(sk)) matches++;
  }
  const forward = matches / profileSkillsCanonical.size;
  const reverse = matches / jobSkills.size;
  return { score: forward * 0.4 + reverse * 0.6, matchCount: matches };
}

// ── Title-based skill extraction for jobs without skills field ──────
function extractSkillsFromTitle(title: string): Set<string> {
  const skills = new Set<string>();
  const lower = title.toLowerCase();
  const checks: [RegExp, string][] = [
    [/\bpython\b/, "python"], [/\bjava\b/, "java"], [/\bjavascript\b|\bjs\b|\btypescript\b|\bts\b/, "javascript"],
    [/\breact\b|\bnext\.?js\b/, "react"], [/\bvue\b|\bnuxt\b/, "vue"], [/\bangular\b/, "angular"],
    [/\bnode\.?js\b|\bnode\b/, "javascript"], [/\bc\+\+\b|\bcpp\b/, "c++"], [/\bc#\b|\.net\b/, "c#"],
    [/\bruby\b|\brails\b/, "ruby"], [/\bphp\b|\blaravel\b/, "php"], [/\bgo\b|\bgolang\b/, "golang"],
    [/\brust\b/, "rust"], [/\bswift\b/, "swift"], [/\bkotlin\b/, "java"],
    [/\baws\b/, "aws"], [/\bgcp\b|\bgoogle cloud\b/, "gcp"], [/\bazure\b/, "azure"],
    [/\bkubernetes\b|\bk8s\b/, "kubernetes"], [/\bdocker\b/, "docker"],
    [/\bml\b|\bmachine learning\b|\bai\b|\bdeep learning\b/, "machine learning"],
    [/\bdata\b/, "data"], [/\bsql\b|\bpostgres\b|\bmysql\b/, "sql"],
    [/\bdevops\b|\bsre\b|\binfra\b/, "devops"], [/\bsecurity\b|\bcyber\b/, "security"],
    [/\bblockchain\b|\bweb3\b|\bsolidity\b|\bcrypto\b/, "web3"],
    [/\bfrontend\b|\bfront-end\b|\bfront end\b/, "frontend"], [/\bbackend\b|\bback-end\b|\bback end\b/, "backend"],
    [/\bfull[- ]?stack\b/, "fullstack"],
  ];
  for (const [re, skill] of checks) {
    if (re.test(lower)) skills.add(skill);
  }
  return skills;
}

// ── Industry scoring with word-boundary matching ────────────────────
function industryScore(jobIndustry: string | null, targetIndustries: string[]): number {
  if (!jobIndustry || targetIndustries.length === 0) return 0;
  const jLower = jobIndustry.toLowerCase();
  for (const ind of targetIndustries) {
    const iLower = ind.toLowerCase();
    // Exact match
    if (jLower === iLower) return 1;
    // Word-boundary check for short terms to prevent "IT" matching "Utilities"
    if (iLower.length <= 3) {
      const re = new RegExp(`\\b${iLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
      if (re.test(jLower)) return 1;
    } else {
      // Longer terms: substring is fine
      if (jLower.includes(iLower) || iLower.includes(jLower)) return 1;
    }
  }
  return 0;
}

// ── Keyword scoring across title + skills + department ──────────────
function keywordScore(
  title: string,
  skillsJson: string | null,
  department: string | null,
  category: string | null,
  keywords: string[]
): { score: number; matches: number } {
  if (keywords.length === 0) return { score: 0, matches: 0 };
  // Build a searchable text blob from all available fields
  const parts = [title];
  if (department) parts.push(department);
  if (category) parts.push(category);
  if (skillsJson) {
    try {
      const arr = JSON.parse(skillsJson);
      if (Array.isArray(arr)) parts.push(arr.join(" "));
    } catch { /* ignore */ }
  }
  const blob = parts.join(" ").toLowerCase();
  let matches = 0;
  for (const kw of keywords) {
    if (blob.includes(kw.toLowerCase())) matches++;
  }
  return { score: keywords.length > 0 ? matches / keywords.length : 0, matches };
}

// ── Location scoring ────────────────────────────────────────────────
function locationScore(jobLocation: string | null, jobRemote: boolean, preference: string | null): number {
  if (!preference) return 0;
  const pref = preference.toLowerCase();
  if (pref === "remote" || pref.includes("remote")) {
    return jobRemote ? 1 : 0;
  }
  if (!jobLocation) return 0;
  const loc = jobLocation.toLowerCase();
  // Check if the preference city/state appears in the job location
  const prefParts = pref.split(/[,\s]+/).filter(p => p.length > 2);
  for (const part of prefParts) {
    if (loc.includes(part)) return 1;
  }
  // Remote jobs are a partial match for any location preference
  if (jobRemote) return 0.5;
  return 0;
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
            role: "system",
            content: `You are a job-matching assistant. Extract structured profile data from a resume to match against a job board database. The database stores job titles like "Software Engineer", "Data Scientist", "Product Manager", "ML Engineer", etc.

IMPORTANT RULES:
- target_roles: Use COMMON job board titles (not niche/academic ones). Include both the specific role AND broader variants. E.g. for an ML person: ["Machine Learning Engineer", "ML Engineer", "Data Scientist", "Software Engineer", "AI Engineer", "Research Engineer"]
- skills: Extract ONLY the canonical/short form of each skill. Use "Python" not "Python 3.9". Use "React" not "React.js/Next.js". Use "AWS" not "Amazon Web Services". Use "SQL" not "PostgreSQL/MySQL". Keep to 10-20 core skills.
- seniority: Infer from years of experience and titles held. 0-1yr=intern, 1-2yr=junior, 2-5yr=mid, 5-10yr=senior, 10+yr=staff/lead
- industries: Use broad categories that match job board filters: "Technology", "Finance", "Healthcare", "E-commerce", "Fintech", "Crypto", "Consulting", etc.
- keywords: Short terms (1-2 words each) that appear in job TITLES — e.g. "backend", "frontend", "data", "platform", "infrastructure", "growth", "analytics". NOT long phrases.
- Heavily weight the user's stated intent. If they say "fintech internships", target_roles should lead with intern-level roles and industries should lead with Fintech.`,
          },
          {
            role: "user",
            content: `RESUME (first 15000 chars):
${text.slice(0, 15000)}

USER INTENT: ${intent || "Looking for relevant roles matching my background"}

Return JSON:
{
  "target_roles": ["4-8 common job titles, broadest first"],
  "skills": ["10-20 canonical short-form skills"],
  "seniority": "intern|junior|mid|senior|staff|lead",
  "industries": ["2-5 broad industry categories"],
  "keywords": ["8-15 short title-friendly search terms"],
  "location_preference": "city/state or 'remote' or null"
}`,
          },
        ],
        temperature: 0.3,
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

    // Normalize: ensure arrays exist and are reasonable
    profile.target_roles = (profile.target_roles || []).slice(0, 10);
    profile.skills = (profile.skills || []).slice(0, 25);
    profile.keywords = (profile.keywords || []).slice(0, 20);
    profile.industries = (profile.industries || []).slice(0, 6);
    profile.seniority = profile.seniority || "mid";
  } catch (e: unknown) {
    console.error("Resume analysis error:", e);
    const msg = e instanceof Error ? e.message : "Failed to analyze resume";
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  // Pre-compute canonical skill set for the profile
  const profileSkillsCanonical = canonicalSkillSet(profile.skills);

  // Build filtered query — apply user's active filters before scoring
  try {
  const whereClauses: string[] = [];
  const queryArgs: (string | number)[] = [];

  // Date filter — use user's "days" param, or default to 30 days
  const daysLimit = filters?.days ? parseInt(filters.days, 10) : 30;
  const cutoff = new Date(Date.now() - daysLimit * 24 * 60 * 60 * 1000).toISOString();
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
    sql: `SELECT j.*, GROUP_CONCAT(DISTINCT b.vc_name) as vc_backers
          FROM jobs j
          LEFT JOIN job_vc_backers b ON j.id = b.job_id
          ${whereStr}
          GROUP BY j.id
          ORDER BY j.posted_date DESC`,
    args: queryArgs,
  });

  // Score each job and keep full row data for matches (avoids second query)
  const scored: { row: Record<string, unknown>; score: number; reasons: string[] }[] = [];
  for (const row of result.rows) {
    const reasons: string[] = [];

    // Title scoring (with synonym expansion)
    const tScore = titleScore(row.title as string, profile.target_roles);
    if (tScore >= 0.8) reasons.push("strong title match");
    else if (tScore >= 0.4) reasons.push("title match");

    // Skill scoring (bidirectional — differentiates resumes heavily)
    let skResult: { score: number; matchCount: number };
    if (row.skills) {
      skResult = skillScore(row.skills as string, profileSkillsCanonical);
    } else {
      const titleSkills = extractSkillsFromTitle(row.title as string);
      skResult = skillScoreFromSet(titleSkills, profileSkillsCanonical);
    }
    const skScore = skResult.score;
    if (skResult.matchCount > 0) {
      reasons.push(`${skResult.matchCount} skill${skResult.matchCount > 1 ? "s" : ""}`);
    }

    // Seniority scoring (with title-based inference fallback)
    const jobSeniority = (row.seniority as string | null) || inferSeniority(row.title as string);
    const senScore = seniorityScore(jobSeniority, profile.seniority);
    if (senScore >= 0.6) reasons.push("seniority match");

    // Industry scoring (with word-boundary matching)
    const indScore = industryScore(row.industry as string | null, profile.industries);
    if (indScore > 0) reasons.push("industry match");

    // Keyword scoring (across title + skills + department + category)
    const kw = keywordScore(
      row.title as string,
      row.skills as string | null,
      row.department as string | null,
      row.category as string | null,
      profile.keywords
    );
    if (kw.matches > 0) reasons.push(`${kw.matches} keyword${kw.matches > 1 ? "s" : ""}`);

    // Location scoring
    const locScore = locationScore(
      row.location as string | null,
      (row.remote as number) === 1,
      profile.location_preference
    );
    if (locScore >= 0.5) reasons.push("location match");

    // Weighted composite — skills-heavy so resume content actually differentiates:
    // skills=35 (up from 25), keywords=20 (up from 15), title=20 (down from 30),
    // seniority=10, industry=10, location=5
    const baseScore =
      tScore * 20 + skScore * 35 + senScore * 10 + indScore * 10 + kw.score * 20 + locScore * 5;

    // Skill-fit bonus: when you match ≥60% of a job's required skills AND ≥30%
    // of your skills appear in the job, add up to 15 bonus points. This is the
    // single biggest differentiator between resumes — it rewards deep skill alignment
    // over shallow "same job title" matches.
    let skillBonus = 0;
    if (skResult.matchCount >= 3 && skScore >= 0.5) {
      skillBonus = Math.min(15, Math.round(skScore * 20));
    }

    const totalScore = Math.round(baseScore + skillBonus);

    if (totalScore >= 20 && reasons.length >= 2) {
      scored.push({ row, score: totalScore, reasons });
    }
  }

  // Sort by score descending, take top 200
  scored.sort((a, b) => b.score - a.score);
  const topJobs = scored.slice(0, 200);

  // Build response directly from already-fetched rows (no second query needed)
  const jobs = topJobs.map(({ row, score, reasons }) => {
    const obj: Record<string, unknown> = {};
    for (const col of result.columns) {
      obj[col] = row[col as keyof typeof row];
    }
    obj.vc_backers = row.vc_backers ? (row.vc_backers as string).split(",") : [];
    obj.remote = (row.remote as number) === 1;
    obj.hybrid = (row.hybrid as number) === 1;
    obj.match_score = score;
    obj.match_reasons = reasons;
    return obj;
  });

  return NextResponse.json({
    profile,
    jobs,
    total: scored.length,
  });

  } catch (e: unknown) {
    console.error("Job matching error:", e);
    const msg = e instanceof Error ? e.message : "Failed to match jobs";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
