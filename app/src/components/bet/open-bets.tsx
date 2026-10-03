"use client";

import Link from "next/link";
import { betPhase, type BetVaultView } from "@pm-amm/sdk";
import { formatUsdc } from "@pm-amm/sdk/math";
import { CardShell } from "@/components/market-cards";
import { Countdown } from "@/components/ui/countdown";
import { useBetVaults } from "@/hooks/use-bet-vaults";
import { betPath, betStakePath } from "@/lib/bets";
import { CategoryChip } from "@/components/category-picker";
import { useCategoryOf } from "@/hooks/use-categories";
import type { CategorySlug } from "@/lib/categories";

function BetCard({ v, category }: { v: BetVaultView; category: string | null }) {
  const yes = Math.round(v.impliedYes * 100);
  const btn =
    "flex-1 text-center py-[8px] rounded-md font-mono text-[12px] font-medium transition-all duration-[120ms]";
  return (
    <CardShell href={betPath(v.vaultId)} label={v.name}>
      <div className="relative z-10 pointer-events-none flex items-center gap-[8px] font-mono text-[10px]">
        <span className="px-[6px] py-[1px] border border-accent/50 text-accent rounded-sm tracking-[0.08em]">
          BET
        </span>
        <CategoryChip slug={category} />
        <span className="ml-auto text-muted">
          stakes close in <Countdown endTs={v.commitEndTs} />
        </span>
      </div>
      <h3 className="relative z-10 pointer-events-none text-[15px] leading-[1.3] text-text-hi line-clamp-2 min-h-[39px]">
        {v.name}
      </h3>
      <div className="relative z-10 pointer-events-none flex justify-between font-mono text-[12px]">
        <span className="text-yes">YES {v.total > 0 ? `${yes}%` : "–"}</span>
        <span className="text-text-dim">pot ${formatUsdc(v.total)}</span>
        <span className="text-no">NO {v.total > 0 ? `${100 - yes}%` : "–"}</span>
      </div>
      <div className="relative z-10 pointer-events-none h-[4px] rounded-full bg-no/30 overflow-hidden">
        <span className="block h-full bg-yes" style={{ width: `${v.total > 0 ? yes : 50}%` }} />
      </div>
      <div className="relative z-10 flex gap-[8px]">
        <Link
          href={betStakePath(v.vaultId, "yes")}
          className={`${btn} bg-yes-soft text-yes hover:bg-yes hover:text-bg`}
        >
          Stake YES
        </Link>
        <Link
          href={betStakePath(v.vaultId, "no")}
          className={`${btn} bg-no-soft text-no hover:bg-no hover:text-bg`}
        >
          Stake NO
        </Link>
      </div>
      <div className="relative z-10 pointer-events-none font-mono text-[10px] text-muted">
        Winner takes the pot · the stakes set the odds
      </div>
    </CardShell>
  );
}

/** Bets still taking stakes (e.g. opened from X with "bet?"), soonest-closing first. */
export function OpenBets({ category = "all" }: { category?: CategorySlug | "all" }) {
  const { data } = useBetVaults();
  const categoryOf = useCategoryOf();
  const now = Math.floor(Date.now() / 1000);
  const open = (data ?? [])
    .filter((v) => betPhase(v, now) === "staking")
    .filter((v) => category === "all" || categoryOf(v.publicKey) === category)
    .sort((a, b) => a.commitEndTs - b.commitEndTs);
  if (!open.length) return null;
  return (
    <section className="border-b border-line">
      <div className="px-[16px] md:px-[24px] pt-[16px] font-mono text-[10px] tracking-[0.08em] uppercase text-muted">
        Open bets · {open.length} taking stakes
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-3 gap-[12px] p-[16px] md:p-[24px]">
        {open.map((v) => (
          <BetCard key={v.publicKey} v={v} category={categoryOf(v.publicKey)} />
        ))}
      </div>
    </section>
  );
}
