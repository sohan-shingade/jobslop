"use client";

import { useState, useRef, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import type { Job } from "@/lib/types";

interface MatchedJob extends Job {
  match_score: number;
  match_reasons: string[];
}

interface ResumeBarProps {
  onMatchResults: (jobs: MatchedJob[], total: number, resumeText?: string, intent?: string) => void;
  onClear: () => void;
  isMatching: boolean;
}

export type { MatchedJob };

export default function ResumeBar({ onMatchResults, onClear, isMatching }: ResumeBarProps) {
  const [intent, setIntent] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const searchParams = useSearchParams();

  const extractText = useCallback(async (pdfFile: File): Promise<string> => {
    const pdfjsLib = await import("pdfjs-dist");
    pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

    const buffer = await pdfFile.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
    const pages: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pages.push(content.items.map((item: any) => item.str || "").join(" "));
    }
    return pages.join("\n");
  }, []);

  const handleMatch = async () => {
    if (!file) return;
    setLoading(true);
    setError(null);

    try {
      const text = await extractText(file);
      if (text.length < 50) {
        setError("Could not extract enough text from the PDF. Is it a scan?");
        setLoading(false);
        return;
      }

      // Pass current filters so the API scores within filtered results
      const filters: Record<string, string> = {};
      searchParams.forEach((value, key) => {
        if (key !== "page" && key !== "sort") filters[key] = value;
      });

      const resp = await fetch("/api/resume-analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, intent, filters }),
      });

      if (resp.status === 429) {
        setError("Rate limit reached. Try again tomorrow.");
        setLoading(false);
        return;
      }

      if (!resp.ok) {
        const data = await resp.json();
        setError(data.error || "Something went wrong");
        setLoading(false);
        return;
      }

      const data = await resp.json();
      onMatchResults(data.jobs, data.total, text, intent);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setError(`Failed to analyze resume: ${msg}`);
      console.error("Resume analysis error:", e);
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    setFile(null);
    setIntent("");
    setError(null);
    if (fileRef.current) fileRef.current.value = "";
    onClear();
  };

  return (
    <div className="border-b border-[var(--border)]">
      <div className="max-w-7xl mx-auto px-4 py-2.5">
        {isMatching ? (
          <div className="flex items-center gap-3">
            <span className="text-[12px] text-[var(--accent)]">
              Showing matches for your resume
            </span>
            <button
              onClick={handleClear}
              className="text-[11px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors duration-100"
            >
              Clear &times;
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <label
              className={`shrink-0 px-2.5 py-1 rounded-md text-[12px] border cursor-pointer transition-colors duration-100 ${
                file
                  ? "border-[var(--accent)]/30 bg-[var(--accent-muted)] text-[var(--accent)]"
                  : "border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--text-tertiary)]"
              }`}
            >
              {file ? file.name.slice(0, 20) : "Upload resume"}
              <input
                ref={fileRef}
                type="file"
                accept=".pdf"
                className="hidden"
                onChange={(e) => {
                  setFile(e.target.files?.[0] || null);
                  setError(null);
                }}
              />
            </label>

            <input
              type="text"
              placeholder="What are you looking for? e.g. fintech internships in NYC"
              value={intent}
              onChange={(e) => setIntent(e.target.value)}
              className="flex-1 px-2.5 py-1 bg-transparent border border-[var(--border)] rounded-md text-[12px] text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:outline-none focus:border-[var(--text-secondary)] transition-colors duration-100"
              onKeyDown={(e) => {
                if (e.key === "Enter" && file) handleMatch();
              }}
            />

            <button
              onClick={handleMatch}
              disabled={!file || loading}
              className="shrink-0 px-3 py-1 rounded-md text-[12px] bg-[var(--accent)] text-[var(--bg)] font-medium disabled:opacity-30 hover:opacity-90 transition-opacity duration-100"
            >
              {loading ? "Analyzing\u2026" : "Match"}
            </button>
          </div>
        )}

        {error && (
          <div className="mt-1.5 text-[11px] text-red-400">{error}</div>
        )}
      </div>
    </div>
  );
}
