# Resume Matching Feature

**Date:** 2026-03-21
**Status:** Approved

## Overview

Add resume-based job matching to jobslop. Users upload a PDF resume and describe what they're looking for in free text. The system extracts a structured profile using Claude, scores all recent jobs against it, and shows results ranked by relevance.

## Flow

1. User uploads PDF resume via file picker
2. User types intent in a text field (e.g., "fintech or quant internships in NYC")
3. Browser extracts text from PDF using pdfjs-dist (no server upload of the file)
4. Extracted text + intent string sent to `POST /api/resume-analyze`
5. API route sends both to Claude API, which returns a structured profile blending resume qualifications with stated goals
6. API route queries Turso for recent jobs (last 14 days)
7. API route scores each job against the profile and returns ranked results
8. Page shows jobs sorted by match score with a "Match" column
9. Existing filters still work on top of matched results

## API

### `POST /api/resume-analyze`

**Request:**
```json
{
  "text": "extracted resume text...",
  "intent": "fintech or quant internships in NYC"
}
```

**Response:**
```json
{
  "profile": {
    "target_roles": ["Quantitative Analyst Intern", "Quant Developer Intern"],
    "skills": ["Python", "Statistics", "Linear Algebra"],
    "seniority": "intern",
    "industries": ["Financial Services", "Fintech"],
    "keywords": ["quantitative", "trading", "risk"],
    "location_preference": "NYC"
  },
  "jobs": [
    {
      "id": "abc123",
      "score": 0.92,
      "reasons": ["title match", "4/5 skills", "seniority match"]
    }
  ],
  "total": 234
}
```

### Claude prompt

Claude receives the resume text and intent, and is instructed to extract:
- `target_roles`: job titles the candidate should be looking for, informed by both their background and stated intent
- `skills`: technical and domain skills from the resume
- `seniority`: level the candidate should target (intern, junior, mid, senior, staff, lead)
- `industries`: industries to target, weighted toward the user's intent
- `keywords`: additional search terms from both resume and intent
- `location_preference`: if the user mentions a location preference

### Scoring

Scoring runs server-side in JavaScript after fetching jobs from Turso. No AI per-job — Claude is called once to extract the profile, then scoring is deterministic.

**Weights:**
- **Title match (40%)**: fuzzy match of job title against `target_roles` using simple substring/keyword overlap
- **Skill overlap (30%)**: intersection of resume skills with job skills (from the `skills` JSON column)
- **Seniority match (15%)**: exact match = full score, adjacent level = half score, else zero
- **Industry match (15%)**: job industry matches any of the profile's target industries

Jobs are scored 0-100 and returned sorted descending. Jobs scoring below a minimum threshold (e.g., 10) are excluded.

### Rate limiting

In-memory Map tracking requests per IP. 10 requests per IP per 24-hour window. Resets on deploy (acceptable for abuse prevention, not security-critical).

Returns `429 Too Many Requests` when exceeded.

## UI Changes

### ResumeBar component

A compact bar below the existing filter bar with:
- File picker / drop zone for PDF upload
- Text input: "What are you looking for?" placeholder
- "Match" button
- All in one row matching the existing dense aesthetic

### Results state

When resume matching is active:
- Job table gains a "Match" column on the left showing the score as a percentage
- Default sort switches to match score descending
- A small dismissible banner: "Showing matches for your resume" with a clear button
- Clearing returns to normal browsing (no match column, default sort)
- Existing filters still work as additional refinement

### No new pages

Everything stays on `/`. Resume upload is another input method for the same job table.

## Technical Details

### New dependencies
- `pdfjs-dist`: client-side PDF text extraction
- `@anthropic-ai/sdk`: Claude API calls from the API route

### New files
- `web/src/app/api/resume-analyze/route.ts`: API route
- `web/src/app/components/ResumeBar.tsx`: upload + intent UI

### Modified files
- `web/src/app/page.tsx`: conditionally render matched results
- `web/src/app/components/JobRow.tsx`: optional match score column
- `web/src/app/components/JobTable.tsx`: match score header

### New env var
- `ANTHROPIC_API_KEY`: set on Vercel for production

### No database changes
No new tables, columns, or indexes. Scoring uses existing job data.
