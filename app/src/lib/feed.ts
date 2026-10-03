import { poolValue } from "@pm-amm/sdk/math";
import type { MarketData } from "@/hooks/use-markets";
import type { GroupData } from "@/hooks/use-groups";

/**
 * The /markets feed: a standalone market or a multi-outcome group (legs
 * collapse into their group). Shared by the card grid and the list view.
 */
export type FeedItem = { kind: "market"; market: MarketData } | { kind: "group"; group: GroupData };

export type FeedStatus = "active" | "expiring" | "resolved-yes" | "resolved-no";

const DAY = 86_400;
const nowSecs = () => Math.floor(Date.now() / 1000);

export function marketStatus(m: MarketData): FeedStatus {
  if (m.resolved) return m.winningSide === 1 ? "resolved-yes" : "resolved-no";
  return m.endTs - nowSecs() <= DAY ? "expiring" : "active";
}

export function groupStatus(g: GroupData): FeedStatus {
  if (g.resolved) return g.winningLeg !== null ? "resolved-yes" : "resolved-no";
  return g.endTs - nowSecs() <= DAY ? "expiring" : "active";
}

/** Pool value of a standalone market (raw collateral units). */
export function marketTvl(m: { lEff: number; price: number }): number {
  return m.lEff > 0 ? poolValue(m.price, m.lEff) : 0;
}

/** Sum of pool values across a group's attached legs. */
export function groupTvl(g: { legs: ({ lEff: number; price: number } | null)[] }): number {
  return g.legs.reduce((sum, leg) => sum + (leg ? marketTvl(leg) : 0), 0);
}

/** Still tradable: not resolved and not past its end time. */
export const isTradable = (m: { resolved: boolean; endTs: number }) =>
  !m.resolved && m.endTs > nowSecs();
