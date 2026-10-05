"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { betPhase } from "@pm-amm/sdk";
import { StatusBar } from "@/components/layout/status-bar";
import { BetPot } from "@/components/bet/bet-pot";
import { BetPhasePanel } from "@/components/bet/bet-phase";
import { BetStakePanel } from "@/components/bet/bet-stake-panel";
import { ShareOnX } from "@/components/share-on-x";
import { MarketArt } from "@/components/market-art";
import { CategoryEditor } from "@/components/category-editor";
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

/** "How it resolves" + the original take (bets the X bot rewrote with Claude). */
function BetRules({ meta }: { meta: BetMeta | null }) {
  if (!meta?.rules) return null;
  return (
    <section className="flex flex-col gap-[6px] rounded-lg border border-line bg-surface/40 p-[14px]">
      <span className="font-mono text-[10px] tracking-[0.1em] uppercase text-muted">
        How it resolves
      </span>
      <p className="text-[13px] leading-[1.5] text-text">{meta.rules}</p>
      {meta.take && meta.take !== meta.question && (
        <p className="text-[12px] text-muted">
          The take: <q className="italic">{meta.take}</q>
        </p>
      )}
    </section>
  );
}

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
            <MarketArt
              account={v.publicKey}
              className="w-full h-[140px] md:h-[180px] rounded-xl border border-line"
            />
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
                <CategoryEditor
                  account={v.publicKey}
                  authority={v.authority}
                  alsoAllowed={v.resolver}
                />
              </div>
            </header>
            <BetRules meta={meta} />
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
