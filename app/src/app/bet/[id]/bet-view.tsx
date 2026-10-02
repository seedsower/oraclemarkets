"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { betPhase } from "@pm-amm/sdk";
import { StatusBar } from "@/components/layout/status-bar";
import { BetPot } from "@/components/bet/bet-pot";
import { BetPhasePanel } from "@/components/bet/bet-phase";
import { BetStakePanel } from "@/components/bet/bet-stake-panel";
import { ShareOnX } from "@/components/share-on-x";
import { useBetVault, useMyBet } from "@/hooks/use-bet-vaults";
import { useMarkets } from "@/hooks/use-markets";
import { betPath, betStakePath, type BetMeta } from "@/lib/bets";
import { parseBuyIntent, type BuySide } from "@/lib/share";

const PHASE_LABEL: Record<string, string> = {
  staking: "Taking stakes",
  "launch-ready": "Launching",
  refundable: "Refunds open",
  live: "Market live",
  "awaiting-resolution": "Awaiting result",
  "settle-ready": "Result in",
  claimable: "Settled",
  voidable: "Unresolved",
  voided: "Voided",
};

export function BetView({ id, meta }: { id: string; meta: BetMeta | null }) {
  const { data: v, isLoading } = useBetVault(Number(id));
  const { data: markets } = useMarkets();
  const { data: me } = useMyBet(v?.publicKey);
  const [intent, setIntent] = useState<{ side: BuySide; amount: number } | null>(null);
  useEffect(() => setIntent(parseBuyIntent(window.location.search)), []);

  const market = v?.market ? markets?.find((m) => m.publicKey === v.market) : undefined;
  const now = Math.floor(Date.now() / 1000);
  const phase = v ? betPhase(v, now, market?.resolved ?? false) : null;
  const question = meta?.question ?? v?.name ?? `Bet #${id}`;

  return (
    <>
      <StatusBar />
      <main className="flex-1 max-w-xl mx-auto w-full px-[20px] md:px-[32px] py-[28px] flex flex-col gap-[20px]">
        <Link href="/markets" className="text-[12px] text-muted hover:text-text-hi font-mono">
          ← MARKETS
        </Link>
        {isLoading && <p className="text-muted font-mono text-[12px]">Loading…</p>}
        {!isLoading && !v && <p className="text-no font-mono text-[12px]">Bet #{id} not found.</p>}
        {v && phase && (
          <>
            <header className="flex flex-col gap-[10px]">
              <span className="font-mono text-[10px] tracking-[0.1em] uppercase text-accent">
                Bet · {PHASE_LABEL[phase]}
              </span>
              <h1 className="text-[24px] md:text-[28px] leading-[1.2] tracking-[-0.02em] text-text-hi">
                {question}
              </h1>
              <div className="flex flex-wrap gap-x-[14px] gap-y-[4px] font-mono text-[11px] text-muted">
                {meta?.sourceUrl && (
                  <a
                    href={meta.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-text-hi"
                  >
                    The take on X ↗
                  </a>
                )}
                {meta?.openedBy && <span>Called by @{meta.openedBy}</span>}
                <span>Resolves {new Date(v.marketEndTs * 1000).toLocaleDateString()}</span>
                <ShareOnX text={`Bet: ${question}`} path={betPath(v.vaultId)} />
              </div>
            </header>
            <BetPot v={v} />
            <BetPhasePanel v={v} phase={phase} me={me} marketId={market?.marketId ?? null} />
            {phase === "staking" && <BetStakePanel v={v} intent={intent} />}
            {phase === "staking" && (
              <p className="font-mono text-[11px] text-muted">
                Share a side:{" "}
                <a className="text-yes" href={betStakePath(v.vaultId, "yes")}>
                  YES $10
                </a>{" "}
                ·{" "}
                <a className="text-no" href={betStakePath(v.vaultId, "no")}>
                  NO $10
                </a>
              </p>
            )}
          </>
        )}
      </main>
    </>
  );
}
