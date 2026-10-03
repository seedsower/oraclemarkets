"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Countdown } from "@/components/ui/countdown";
import { CommunityBadge } from "@/components/ui/community-badge";
import { Sparkline } from "@/components/ui/sparkline";
import { StatusBadge } from "@/components/ui/status-badge";
import type { MarketData } from "@/hooks/use-markets";
import type { GroupData } from "@/hooks/use-groups";
import {
  groupStatus,
  groupTvl,
  isTradable,
  marketStatus,
  marketTvl,
  type FeedItem,
} from "@/lib/feed";
import { buyPath, cents, groupPath, legLabel, marketPath } from "@/lib/share";
import { findToken } from "@/lib/tokens";

type IsCommunity = (item: { authority: string; publicKey: string }) => boolean;

/**
 * Card shell: the whole card links to `href` via an overlay, so inner action
 * links (buy buttons) can sit above it without nesting <a> inside <a>.
 */
export function CardShell({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <article className="relative flex flex-col gap-[12px] rounded-xl border border-line bg-surface/40 p-[16px] transition-all duration-[120ms] hover:border-line-2 hover:bg-surface">
      <Link href={href} aria-label={label} className="absolute inset-0 z-0 rounded-xl" />
      {children}
    </article>
  );
}

/** Card-friendly amount: "243 mUSDC", "12.5 USDC" (whole units at ≥ 100). */
function liquidity(raw: number, mint: string): string {
  const tk = findToken(mint);
  const value = raw / 10 ** (tk?.decimals ?? 6);
  const n = value.toLocaleString("en-US", { maximumFractionDigits: value >= 100 ? 0 : 2 });
  return `${n} ${tk?.symbol ?? ""}`.trim();
}

function CardHeader(props: {
  status: ReturnType<typeof marketStatus>;
  endTs: number;
  community: boolean;
}) {
  return (
    <div className="relative z-10 pointer-events-none flex items-center gap-[8px] font-mono text-[10px] text-muted">
      <StatusBadge variant={props.status} />
      {props.community && <CommunityBadge />}
      {!props.status.startsWith("resolved") && (
        <span className="ml-auto">
          <Countdown endTs={props.endTs} />
        </span>
      )}
    </div>
  );
}

function BuyButtons({ m }: { m: MarketData }) {
  if (!isTradable(m)) {
    const result = m.resolved
      ? m.winningSide === 1
        ? "Resolved: YES"
        : "Resolved: NO"
      : "Trading closed";
    return (
      <div className="relative z-10 pointer-events-none font-mono text-[12px] text-text-dim">
        {result}
      </div>
    );
  }
  const btn =
    "flex-1 text-center py-[8px] rounded-md font-mono text-[12px] font-medium transition-all duration-[120ms]";
  return (
    <div className="relative z-10 flex gap-[8px]">
      <Link
        href={buyPath(m.marketId, "yes")}
        className={`${btn} bg-yes-soft text-yes hover:bg-yes hover:text-bg`}
      >
        Buy YES {cents(m.price)}
      </Link>
      <Link
        href={buyPath(m.marketId, "no")}
        className={`${btn} bg-no-soft text-no hover:bg-no hover:text-bg`}
      >
        Buy NO {cents(1 - m.price)}
      </Link>
    </div>
  );
}

export function MarketCard(props: {
  m: MarketData;
  history?: number[];
  isCommunity?: IsCommunity;
}) {
  const { m } = props;
  const yes = Math.round(m.price * 100);
  return (
    <CardShell href={marketPath(m.marketId)} label={m.name}>
      <CardHeader status={marketStatus(m)} endTs={m.endTs} community={!!props.isCommunity?.(m)} />
      <h3 className="relative z-10 pointer-events-none text-[15px] leading-[1.3] text-text-hi line-clamp-2 min-h-[39px]">
        {m.name}
      </h3>
      <div className="relative z-10 pointer-events-none flex items-end justify-between gap-[12px]">
        <div className="flex items-baseline gap-[6px]">
          <span
            className={`text-[30px] leading-none tracking-[-0.02em] ${yes >= 50 ? "text-yes" : "text-no"}`}
          >
            {yes}%
          </span>
          <span className="font-mono text-[10px] text-muted">chance</span>
        </div>
        <Sparkline
          points={props.history ?? [m.price, m.price]}
          color={m.price >= 0.5 ? "var(--yes)" : "var(--no)"}
          width={96}
          height={28}
        />
      </div>
      <div className="relative z-10 pointer-events-none h-[4px] rounded-full bg-no/30 overflow-hidden">
        <span className="block h-full bg-yes" style={{ width: `${yes}%` }} />
      </div>
      <BuyButtons m={m} />
      <div className="relative z-10 pointer-events-none font-mono text-[10px] text-muted">
        {liquidity(marketTvl(m), m.collateralMint)} liquidity
      </div>
    </CardShell>
  );
}

const MAX_OUTCOMES = 3;

export function GroupCard(props: { g: GroupData; isCommunity?: IsCommunity }) {
  const { g } = props;
  const legs = g.legs.filter((l): l is MarketData => l !== null).sort((a, b) => b.price - a.price);
  const mint = legs[0]?.collateralMint ?? "";
  return (
    <CardShell href={groupPath(g.groupId)} label={g.name}>
      <CardHeader status={groupStatus(g)} endTs={g.endTs} community={!!props.isCommunity?.(g)} />
      <h3 className="relative z-10 pointer-events-none text-[15px] leading-[1.3] text-text-hi line-clamp-2 min-h-[39px]">
        {g.name}
      </h3>
      <ul className="relative z-10 pointer-events-none flex flex-col gap-[8px]">
        {legs.slice(0, MAX_OUTCOMES).map((l, i) => (
          <li key={l.publicKey} className="flex flex-col gap-[4px]">
            <div className="flex justify-between text-[13px]">
              <span className="text-text truncate">{legLabel(l.name)}</span>
              <span className={`font-mono ${i === 0 ? "text-yes" : "text-text-dim"}`}>
                {Math.round(l.price * 100)}%
              </span>
            </div>
            <div className="h-[3px] rounded-full bg-line overflow-hidden">
              <span
                className={`block h-full ${i === 0 ? "bg-yes" : "bg-text-dim/60"}`}
                style={{ width: `${Math.round(l.price * 100)}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
      <div className="relative z-10 pointer-events-none mt-auto flex justify-between font-mono text-[10px] text-muted">
        <span>{liquidity(groupTvl(g), mint)} liquidity</span>
        {legs.length > MAX_OUTCOMES && <span>+{legs.length - MAX_OUTCOMES} more outcomes</span>}
      </div>
    </CardShell>
  );
}

export function MarketCards(props: {
  items: FeedItem[];
  priceHistories?: Map<string, number[]>;
  isCommunity?: IsCommunity;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-3 gap-[12px] p-[16px] md:p-[24px]">
      {props.items.map((it) =>
        it.kind === "market" ? (
          <MarketCard
            key={it.market.publicKey}
            m={it.market}
            history={props.priceHistories?.get(it.market.publicKey)}
            isCommunity={props.isCommunity}
          />
        ) : (
          <GroupCard key={it.group.publicKey} g={it.group} isCommunity={props.isCommunity} />
        ),
      )}
    </div>
  );
}
