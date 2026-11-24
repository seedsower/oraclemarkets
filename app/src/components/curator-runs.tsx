"use client";

import { useQuery } from "@tanstack/react-query";
import { useMarkets } from "@/hooks/use-markets";
import Link from "next/link";

/** Shape written by workers/curator/src/report.ts (only the fields shown here). */
interface Row {
  questionId: string;
  category: string;
  name: string;
  result: string;
  market?: string;
  priceBps?: number;
  signature?: string;
}
interface Run {
  at: string;
  finishedAt: string;
  dryRun: boolean;
  trigger: string;
  budget: { allowed: number; limitedBy: string } | null;
  seedUsdc: number;
  rows: Row[];
  skips: Record<string, number>;
  lifecycle: { refreshed: number; featured: number; unfeatured: number; review: number } | null;
  mcpCalls: number;
  errors: string[];
  summary: {
    created: number;
    wouldCreate: number;
    failed: number;
    linked: number;
    overBudget: number;
  };
}

const when = (iso: string) =>
  new Date(iso).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

const tx = (sig: string) => `https://solscan.io/tx/${sig}?cluster=devnet`;

function Rows({ rows }: { rows: Row[] }) {
  const { data: markets } = useMarkets();
  const idOf = (pk?: string) => markets?.find((m) => m.publicKey === pk)?.marketId;
  return (
    <ul className="space-y-[4px] text-[12px]">
      {rows.map((r) => {
        const id = idOf(r.market);
        return (
          <li key={r.questionId} className="flex gap-[8px] flex-wrap items-baseline">
            <span className="font-mono text-[11px] text-muted w-[110px] shrink-0">{r.result}</span>
            <span className="font-mono text-[11px] text-muted">[{r.category}]</span>
            {id !== undefined ? (
              <Link href={`/market/${id}`} className="text-text-hi hover:underline">
                {r.name}
              </Link>
            ) : (
              <span className="text-text">{r.name}</span>
            )}
            {r.priceBps !== undefined && (
              <span className="font-mono text-[11px] text-muted">
                {Math.round(r.priceBps / 100)}%
              </span>
            )}
            {r.signature && (
              <a
                href={tx(r.signature)}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-[11px] text-muted hover:text-text-hi"
              >
                tx ↗
              </a>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function RunCard({ run }: { run: Run }) {
  const s = run.summary;
  const headline = run.dryRun
    ? `${s.wouldCreate} would be created`
    : `${s.created} created${s.failed ? `, ${s.failed} failed` : ""}`;
  const skips = Object.entries(run.skips).sort((a, b) => b[1] - a[1]);
  return (
    <details className="border border-line rounded-xl p-[14px]">
      <summary className="cursor-pointer flex gap-[10px] flex-wrap items-baseline">
        <span className="text-[13px] text-text-hi">{when(run.at)}</span>
        <span
          className={`font-mono text-[11px] uppercase ${run.dryRun ? "text-muted" : "text-yes"}`}
        >
          {run.trigger === "failed" ? "failed" : run.dryRun ? `dry run (${run.trigger})` : "live"}
        </span>
        <span className="text-[12px] text-muted">{headline}</span>
        {run.errors.length > 0 && (
          <span className="font-mono text-[11px] text-no">{run.errors.length} errors</span>
        )}
      </summary>
      <div className="mt-[12px] space-y-[12px] text-[12px] text-muted">
        <p className="font-mono text-[11px]">
          {run.budget
            ? `Budget: up to ${run.budget.allowed} new (limited by ${run.budget.limitedBy}) · `
            : ""}
          seed {run.seedUsdc} USDC · {s.linked} already linked · {s.overBudget} over budget ·{" "}
          {run.mcpCalls} partner calls
          {run.lifecycle &&
            ` · AI lines refreshed ${run.lifecycle.refreshed}, unfeatured ${run.lifecycle.unfeatured}, for review ${run.lifecycle.review}`}
        </p>
        {run.rows.length > 0 && <Rows rows={run.rows} />}
        {skips.length > 0 && (
          <div>
            <p className="font-mono text-[11px] uppercase mb-[4px]">Skipped by selection</p>
            {skips.map(([reason, n]) => (
              <p key={reason} className="font-mono text-[11px]">
                {n}× {reason}
              </p>
            ))}
          </div>
        )}
        {run.errors.map((e, i) => (
          <p key={i} className="font-mono text-[11px] text-no">
            {e}
          </p>
        ))}
      </div>
    </details>
  );
}

/** Admin: the curator's last 10 runs (live, scheduled dry runs and previews). */
export function CuratorRuns() {
  const { data } = useQuery({
    queryKey: ["curator-runs"],
    queryFn: async (): Promise<Run[]> =>
      ((await (await fetch("/api/admin/curator/runs")).json()) as { runs: Run[] }).runs,
    refetchInterval: 60_000,
  });
  if (!data) return null;
  if (data.length === 0)
    return <p className="text-[12px] text-muted font-mono">No runs recorded yet.</p>;
  return (
    <div className="space-y-[10px]">
      {data.map((r) => (
        <RunCard key={r.at} run={r} />
      ))}
    </div>
  );
}
