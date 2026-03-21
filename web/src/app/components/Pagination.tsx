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
    <div className="flex flex-col items-center gap-3 py-8">
      <div className="text-sm text-zinc-500">
        Showing {showing.toLocaleString()} of {total.toLocaleString()} jobs
      </div>
      {hasMore && (
        <button
          onClick={loadMore}
          disabled={isPending}
          className="px-6 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm rounded-lg border border-zinc-700 transition-colors disabled:opacity-50"
        >
          {isPending ? "Loading..." : "Load more"}
        </button>
      )}
    </div>
  );
}
