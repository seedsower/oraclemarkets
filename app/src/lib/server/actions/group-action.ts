import type { ActionGetResponse } from "@solana/actions";
import type { GroupView, MarketView } from "@pm-amm/sdk";
import { FEATURED_AUTHORITIES } from "@/lib/featured-list";
import { cents, closesIn, legLabel } from "@/lib/share";
import { disabledReason } from "./market-action";

export const GROUP_BUTTON_USDC = 10;
const MAX_LEG_BUTTONS = 6;

export interface TradableLeg {
  index: number;
  market: MarketView;
}

/** Attached legs (by slot index) that a Blink can buy right now, highest price first. */
export function tradableLegs(g: GroupView, now: number): TradableLeg[] {
  return g.legs
    .map((market, index) => ({ market, index }))
    .filter((l): l is TradableLeg => l.market !== null)
    .filter((l) => disabledReason(l.market, now, { featuredOnly: false, featured: true }) === null)
    .sort((a, b) => b.market.price - a.market.price);
}

export function groupDisabledReason(
  g: GroupView,
  now: number,
  opts: { featuredOnly: boolean },
): string | null {
  if (g.resolved) return "This market is resolved.";
  if (now >= g.endTs) return "Trading has closed; this market is awaiting resolution.";
  if (opts.featuredOnly && !FEATURED_AUTHORITIES.has(g.authority)) {
    return "This market isn't available as a Blink.";
  }
  if (tradableLegs(g, now).length === 0) return "No outcome can be traded from a Blink right now.";
  return null;
}

export function groupActionGet(
  g: GroupView,
  o: { base: string; iconUrl: string; disabled: string | null; now: number },
): ActionGetResponse {
  const legs = tradableLegs(g, o.now).slice(0, MAX_LEG_BUTTONS);
  const odds = legs
    .slice(0, 3)
    .map((l) => `${legLabel(l.market.name)} ${cents(l.market.price)}`)
    .join(" · ");
  return {
    type: "action",
    icon: o.iconUrl,
    title: g.name,
    description: `${odds}${odds ? " · " : ""}${closesIn(g.endTs, o.now)}. Resolved by the market creator (${g.authority.slice(0, 4)}…${g.authority.slice(-4)}). 2% fee on buys.`,
    label: "Predict",
    ...(o.disabled ? { disabled: true, error: { message: o.disabled } } : {}),
    links: {
      actions: legs.map((l) => ({
        type: "transaction" as const,
        label: `${legLabel(l.market.name)} YES $${GROUP_BUTTON_USDC}`,
        href: `${o.base}?leg=${l.index}&amount=${GROUP_BUTTON_USDC}`,
      })),
    },
  };
}
