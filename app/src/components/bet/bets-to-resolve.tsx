"use client";

import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { betPhase } from "@pm-amm/sdk";
import { formatUsdc } from "@pm-amm/sdk/math";
import { useBetVaults } from "@/hooks/use-bet-vaults";
import { useMarkets } from "@/hooks/use-markets";
import { betPath } from "@/lib/bets";
import { ResolveButtons } from "./bet-phase";

/**
 * Admin: bets this wallet resolves whose market has ended. Resolving also
 * settles, so winners can claim straight away.
 */
export function BetsToResolve() {
  const { publicKey } = useWallet();
  const { data: bets } = useBetVaults();
  const { data: markets } = useMarkets();
  if (!publicKey) return null;

  const me = publicKey.toBase58();
  const now = Math.floor(Date.now() / 1000);
  const resolvedMarkets = new Set(
    (markets ?? []).filter((m) => m.resolved).map((m) => m.publicKey),
  );
  const due = (bets ?? []).filter((v) => {
    const phase = betPhase(v, now, resolvedMarkets.has(v.market));
    return v.resolver === me && (phase === "awaiting-resolution" || phase === "voidable");
  });

  if (!due.length) {
    return <p className="text-[12px] text-muted font-mono">No bets waiting for your result.</p>;
  }
  return (
    <div className="space-y-[10px]">
      {due.map((v) => (
        <div key={v.publicKey} className="border border-line p-[14px] flex flex-col gap-[10px]">
          <Link href={betPath(v.vaultId)} className="text-[13px] text-text-hi hover:underline">
            {v.name}
          </Link>
          <div className="font-mono text-[11px] text-muted">
            Pot ${formatUsdc(v.total)} · ended {new Date(v.marketEndTs * 1000).toLocaleString()}
          </div>
          <ResolveButtons v={v} />
        </div>
      ))}
    </div>
  );
}
