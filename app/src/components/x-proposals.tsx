"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { XProposal } from "@/app/api/proposals/route";

/** Days from now until `deadline` (≥ 1), for prefilling /create's duration. */
function daysUntil(deadline: string | null): number | null {
  if (!deadline) return null;
  const days = Math.ceil((Date.parse(deadline) - Date.now()) / 86_400_000);
  return Number.isFinite(days) && days >= 1 ? days : null;
}

export function createHref(p: XProposal): string {
  const q = new URLSearchParams({ name: p.question.slice(0, 64) });
  const days = daysUntil(p.deadline);
  if (days) q.set("days", String(days));
  return `/create?${q}`;
}

/** Admin tab: market ideas submitted by mentioning the bot on X. */
export function XProposals() {
  const { data, isLoading } = useQuery<XProposal[]>({
    queryKey: ["x-proposals"],
    queryFn: async () => {
      const res = await fetch("/api/proposals");
      return res.ok ? ((await res.json()).proposals as XProposal[]) : [];
    },
    refetchInterval: 60_000,
  });

  if (isLoading) return <p className="text-[12px] text-muted font-mono">Loading…</p>;
  if (!data?.length) {
    return (
      <p className="text-[12px] text-muted font-mono">
        No proposals yet. People submit them by posting “@bot propose &lt;question&gt; by
        &lt;date&gt;”.
      </p>
    );
  }
  return (
    <div className="space-y-[10px]">
      {data.map((p) => (
        <div key={p.id} className="border border-line p-[14px] flex flex-col gap-[8px]">
          <div className="text-[13px] text-text-hi leading-[1.35]">{p.question}</div>
          <div className="flex flex-wrap items-center gap-x-[12px] gap-y-[4px] font-mono text-[11px] text-muted">
            <span>by {p.deadline ? p.deadline.slice(0, 10) : `“${p.by}” (unparsed)`}</span>
            <a
              href={p.tweetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-text-hi"
            >
              @{p.handle || "unknown"} ↗
            </a>
            <span>{new Date(p.createdAt).toLocaleDateString()}</span>
            <Link
              href={createHref(p)}
              className="ml-auto px-[10px] py-[4px] bg-text-hi text-bg rounded-sm font-medium hover:opacity-90"
            >
              Create market →
            </Link>
          </div>
        </div>
      ))}
    </div>
  );
}
