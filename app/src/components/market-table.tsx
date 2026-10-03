"use client";

import { useRouter } from "next/navigation";
import { StatusBadge } from "@/components/ui/status-badge";
import { Sparkline } from "@/components/ui/sparkline";
import { Countdown } from "@/components/ui/countdown";
import { formatAmount } from "@pm-amm/sdk/math";
import {
  groupStatus as getGroupStatus,
  groupTvl,
  marketTvl,
  marketStatus as getMarketStatus,
  type FeedItem,
} from "@/lib/feed";
import { findToken } from "@/lib/tokens";
import type { MarketData } from "@/hooks/use-markets";
import { CommunityBadge } from "@/components/ui/community-badge";

export type { FeedItem } from "@/lib/feed";

interface MarketTableProps {
  items: FeedItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  priceHistories?: Map<string, number[]>;
  /** When set, rows it returns true for get a "community" badge (see lib/featured.ts). */
  isCommunity?: (item: { authority: string; publicKey: string }) => boolean;
}

const GRID_COLS = "grid-cols-[1fr_60px_160px_80px_72px_60px]";

export function MarketTable({
  items,
  selectedId,
  onSelect,
  priceHistories,
  isCommunity,
}: MarketTableProps) {
  const router = useRouter();

  return (
    <div className="flex-1 min-w-0 flex flex-col overflow-x-auto">
      {/* Header */}
      <div
        className={[
          "grid gap-[12px] px-[24px] py-[10px]",
          "border-b border-line",
          "font-mono text-[10px] text-muted uppercase tracking-[0.08em]",
          GRID_COLS,
        ].join(" ")}
      >
        <div>Market</div>
        <div>Trend</div>
        <div className="text-center">Probability</div>
        <div className="text-right">TVL</div>
        <div className="text-right">Expires</div>
        <div className="text-right">Status</div>
      </div>

      {/* Rows */}
      {items.map((item) => {
        if (item.kind === "market") {
          const m = item.market;
          const status = getMarketStatus(m);
          const isResolved = m.resolved;
          const isSelected = selectedId === m.publicKey;
          const pv = marketTvl(m);
          const tk = findToken(m.collateralMint);
          const yesP = Math.round(m.price * 100);
          const noP = 100 - yesP;

          return (
            <div
              key={m.publicKey}
              onClick={() => onSelect(m.publicKey)}
              onDoubleClick={() => router.push(`/market/${m.marketId}`)}
              className={[
                "grid gap-[12px] px-[24px] items-center",
                "border-b border-line font-mono text-[12px]",
                "cursor-pointer relative transition-all duration-[120ms]",
                "h-[var(--row)]",
                isSelected ? "bg-surface" : "hover:bg-surface",
                isResolved ? "opacity-55 hover:opacity-100" : "",
                GRID_COLS,
              ].join(" ")}
            >
              {isSelected && <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-accent" />}

              <div className="min-w-0 font-sans text-[13px] text-text-hi tracking-[-0.005em] truncate flex items-center gap-[6px]">
                <span className="truncate">{m.name}</span>
                {isCommunity?.(m) && <CommunityBadge />}
              </div>

              <div>
                <Sparkline
                  points={priceHistories?.get(m.publicKey) ?? [m.price, m.price]}
                  color={m.price >= 0.5 ? "var(--yes)" : "var(--no)"}
                  width={48}
                  height={18}
                />
              </div>

              <div className="flex items-center gap-[6px]">
                <span className="text-yes text-[11px] tnum w-[32px] text-right">{yesP}%</span>
                <div className="flex-1 h-[2px] bg-no/20 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-yes rounded-full transition-all duration-[300ms]"
                    style={{ width: `${yesP}%` }}
                  />
                </div>
                <span className="text-no text-[11px] tnum w-[32px]">{noP}%</span>
              </div>

              <div className="text-right tnum text-text">
                {formatAmount(pv, tk?.decimals ?? 6, { symbol: tk?.symbol ?? "" })}
              </div>
              <div className="text-right text-[11px]">
                <Countdown endTs={m.endTs} />
              </div>
              <div className="text-right">
                <StatusBadge variant={status} />
              </div>
            </div>
          );
        }

        // Group row — N legs collapsed into one entry.
        // Single-click routes to `/group/[id]` (no detail panel for groups
        // since there's no single price to chart in the right column).
        const g = item.group;
        const status = getGroupStatus(g);
        const isResolved = g.resolved;
        const pv = groupTvl(g);
        const gtk = findToken(g.legs.find((l) => l)?.collateralMint ?? "");
        // Top leg = highest implied probability across the attached legs.
        // For a freshly-launched vault group, all legs share the same price
        // until trading starts.
        const topLeg = g.legs
          .filter((l): l is MarketData => l !== null)
          .sort((a, b) => b.price - a.price)[0];
        const topPct = topLeg ? Math.round(topLeg.price * 100) : 0;

        return (
          <div
            key={g.publicKey}
            onClick={() => router.push(`/group/${g.groupId}`)}
            className={[
              "grid gap-[12px] px-[24px] items-center",
              "border-b border-line font-mono text-[12px]",
              "cursor-pointer relative transition-all duration-[120ms]",
              "h-[var(--row)]",
              "hover:bg-surface",
              isResolved ? "opacity-55 hover:opacity-100" : "",
              GRID_COLS,
            ].join(" ")}
          >
            <div className="min-w-0 font-sans text-[13px] text-text-hi tracking-[-0.005em] truncate flex items-center gap-[6px]">
              <span className="truncate">{g.name}</span>
              <span className="text-[9px] px-[5px] py-[1px] border border-yes/40 text-yes font-mono tracking-[0.05em] uppercase shrink-0">
                {g.legCount}-way
              </span>
              {isCommunity?.(g) && <CommunityBadge />}
            </div>

            {/* No sparkline for groups (no single price) */}
            <div />

            {/* Multi-outcome: show top leg's name + probability */}
            <div className="flex items-center gap-[6px] text-[11px]">
              {topLeg ? (
                <>
                  <span className="text-muted truncate flex-1 min-w-0">
                    Top: {topLeg.name.split(" - ").slice(-1)[0]}
                  </span>
                  <span className="text-yes tnum w-[36px] text-right">{topPct}%</span>
                </>
              ) : (
                <span className="text-muted text-[10px] italic">no legs yet</span>
              )}
            </div>

            <div className="text-right tnum text-text">
              {formatAmount(pv, gtk?.decimals ?? 6, { symbol: gtk?.symbol ?? "" })}
            </div>
            <div className="text-right text-[11px]">
              <Countdown endTs={g.endTs} />
            </div>
            <div className="text-right">
              <StatusBadge variant={status} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
