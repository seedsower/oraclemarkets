"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useWallet } from "@solana/wallet-adapter-react";
import { betPhase, type BetVaultView } from "@pm-amm/sdk";
import { formatUsdc } from "@pm-amm/sdk/math";
import { useBetVaults } from "@/hooks/use-bet-vaults";
import { useMarkets } from "@/hooks/use-markets";
import { betPath } from "@/lib/bets";
import { callStatus, STATUS_ORDER, type CallRecord, type CallStatus } from "@/lib/bet-calls";
import { ResolveButtons } from "./bet-phase";

function useBetCalls() {
  return useQuery({
    queryKey: ["bet-calls"],
    queryFn: async (): Promise<Record<string, CallRecord>> =>
      ((await (await fetch("/api/bets/calls")).json()) as { calls: Record<string, CallRecord> })
        .calls,
    refetchInterval: 30_000,
  });
}

const when = (ts: number) =>
  new Date(ts * 1000).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

/** What the players said, in one line (plus who said it). */
function CallLine({ status, rec }: { status: CallStatus; rec?: CallRecord }) {
  const who = [
    ...Object.values(rec?.calls ?? {}).map((c) => `@${c.handle}: ${c.side.toUpperCase()}`),
    ...Object.values(rec?.disputes ?? {}).map((d) => `@${d.handle}: dispute`),
  ].join(" · ");
  const text =
    status.kind === "ready"
      ? `Ready: ${status.side.toUpperCase()} (${status.why === "agreed" ? "both sides agree" : "no dispute in 24h"})`
      : status.kind === "pending"
        ? `Called ${status.side.toUpperCase()}; dispute window ends ${when(status.readyAt)}`
        : status.kind === "disputed"
          ? "Disputed: your call"
          : "No call from the players yet";
  const tone =
    status.kind === "ready" ? "text-yes" : status.kind === "disputed" ? "text-no" : "text-muted";
  return (
    <div className="font-mono text-[11px] flex flex-col gap-[2px]">
      <span className={tone}>{text}</span>
      {who && <span className="text-muted">{who}</span>}
    </div>
  );
}

/**
 * Admin: bets this wallet resolves whose market has ended, with what the
 * players called on X (ready ones first). Resolving also settles, so winners
 * — including X-wallet stakers, paid by the bot — get paid straight away.
 */
export function BetsToResolve() {
  const { publicKey } = useWallet();
  const { data: bets } = useBetVaults();
  const { data: markets } = useMarkets();
  const { data: calls } = useBetCalls();
  if (!publicKey) return null;

  const me = publicKey.toBase58();
  const now = Math.floor(Date.now() / 1000);
  const resolvedMarkets = new Set(
    (markets ?? []).filter((m) => m.resolved).map((m) => m.publicKey),
  );
  const due = (bets ?? [])
    .filter((v) => {
      const phase = betPhase(v, now, resolvedMarkets.has(v.market));
      return v.resolver === me && (phase === "awaiting-resolution" || phase === "voidable");
    })
    .map((v): [BetVaultView, CallStatus] => [v, callStatus(calls?.[v.publicKey], now)])
    .sort(
      ([a, sa], [b, sb]) =>
        STATUS_ORDER[sa.kind] - STATUS_ORDER[sb.kind] || a.marketEndTs - b.marketEndTs,
    );

  if (!due.length) {
    return <p className="text-[12px] text-muted font-mono">No bets waiting for your result.</p>;
  }
  return (
    <div className="space-y-[10px]">
      {due.map(([v, status]) => (
        <div
          key={v.publicKey}
          className="border border-line rounded-lg p-[14px] flex flex-col gap-[10px]"
        >
          <Link href={betPath(v.vaultId)} className="text-[13px] text-text-hi hover:underline">
            {v.name}
          </Link>
          <div className="font-mono text-[11px] text-muted">
            Pot ${formatUsdc(v.total)} · ended {new Date(v.marketEndTs * 1000).toLocaleString()}
          </div>
          <CallLine status={status} rec={calls?.[v.publicKey]} />
          <ResolveButtons
            v={v}
            suggested={
              status.kind === "ready" || status.kind === "pending" ? status.side : undefined
            }
          />
        </div>
      ))}
    </div>
  );
}
