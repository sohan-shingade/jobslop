"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

interface PaginationProps {
  total: number;
  page: number;
  pageSize: number;
}

export default function Pagination({ total, page, pageSize }: PaginationProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const showing = Math.min(page * pageSize, total);
  const hasMore = showing < total;

  const loadMore = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", String(page + 1));
    startTransition(() => {
      router.push(`?${params.toString()}`, { scroll: false });
    });
  };

  return (
    <div className="flex flex-col items-center gap-3 py-10">
      <div className="text-[12px] font-[family-name:var(--font-geist-mono)] text-[var(--text-tertiary)] tabular-nums">
        {showing.toLocaleString()} of {total.toLocaleString()}
      </div>
      {hasMore && (
        <button
          onClick={loadMore}
          disabled={isPending}
          className="px-5 py-1.5 text-[12px] text-[var(--text-secondary)] border border-[var(--border)] rounded-md hover:text-[var(--text-primary)] hover:border-[var(--text-secondary)] transition-colors duration-100 disabled:opacity-40"
        >
          {isPending ? "Loading\u2026" : "Load more"}
        </button>
      )}
    </div>
  );
}
