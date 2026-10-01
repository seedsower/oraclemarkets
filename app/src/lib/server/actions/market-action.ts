import type { ActionGetResponse, LinkedAction } from "@solana/actions";
import type { MarketView, VaultView } from "@pm-amm/sdk";
import { USDC_MINT } from "@/lib/constants";
import { FEATURED_AUTHORITIES } from "@/lib/featured-list";
import { LIST_CACHE } from "@/lib/list-cache";
import { redis } from "@/lib/redis";
import { cents, marketSummary } from "@/lib/share";
import { ACTIONS_CONFIG } from "./common";

export const QUICK_AMOUNTS = [5, 25] as const;

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

/** Featured = created by a featured authority, or launched from a featured creator's vault. */
export async function isFeaturedMarket(m: MarketView): Promise<boolean> {
  if (FEATURED_AUTHORITIES.has(m.authority)) return true;
  try {
    const raw = redis ? await redis.get(LIST_CACHE.vaults) : null;
    const vaults = raw ? ((JSON.parse(raw) as { items?: VaultView[] }).items ?? []) : [];
    return vaults.some((v) => v.market === m.publicKey && FEATURED_AUTHORITIES.has(v.authority));
  } catch {
    return false;
  }
}

/** Why this market can't be traded from a Blink, or null when it can. */
export function disabledReason(
  m: MarketView,
  now: number,
  opts: { featuredOnly: boolean; featured: boolean },
): string | null {
  if (m.resolved) return `This market is resolved (${m.winningSide === 1 ? "YES" : "NO"} won).`;
  if (now >= m.endTs) return "Trading has closed; this market is awaiting resolution.";
  if (m.lEff <= 0 || (m.reserveYes === 0 && m.reserveNo === 0)) {
    return "This market has no liquidity yet.";
  }
  if (m.collateralMint !== USDC_MINT.toBase58()) {
    return "Blinks support USDC markets only. Open the market page to trade.";
  }
  if (opts.featuredOnly && !opts.featured) return "This market isn't available as a Blink.";
  return null;
}

function resolverLine(m: MarketView): string {
  return m.group
    ? `Resolved by the group creator (${short(m.group)}).`
    : `Resolved by the market creator (${short(m.authority)}).`;
}

function sideLinks(base: string, side: "yes" | "no", maxUsdc: number): LinkedAction[] {
  const S = side.toUpperCase();
  const quick: LinkedAction[] = QUICK_AMOUNTS.map((amt) => ({
    type: "transaction",
    label: `${S} $${amt}`,
    href: `${base}?side=${side}&amount=${amt}`,
  }));
  const custom: LinkedAction = {
    type: "transaction",
    label: `Buy ${S}`,
    href: `${base}?side=${side}&amount={amount}`,
    parameters: [
      {
        type: "number",
        name: "amount",
        label: `USDC on ${S} (1–${maxUsdc})`,
        required: true,
        min: ACTIONS_CONFIG.minUsdc,
        max: maxUsdc,
      },
    ],
  };
  return [...quick, custom];
}

/** ActionGetResponse for a binary market. `base` = this action's API path. */
export function marketActionGet(
  m: MarketView,
  o: { base: string; iconUrl: string; disabled: string | null; maxUsdc?: number },
): ActionGetResponse {
  const maxUsdc = o.maxUsdc ?? ACTIONS_CONFIG.maxUsdc;
  const [yes, no] = [sideLinks(o.base, "yes", maxUsdc), sideLinks(o.base, "no", maxUsdc)];
  return {
    type: "action",
    icon: o.iconUrl,
    title: m.name,
    description: `${marketSummary(m)}. ${resolverLine(m)} 2% fee on buys.`,
    label: "Predict",
    ...(o.disabled ? { disabled: true, error: { message: o.disabled } } : {}),
    links: {
      // Quick buttons first (YES $5, YES $25, NO $5, NO $25), then the inputs.
      actions: [yes[0]!, yes[1]!, no[0]!, no[1]!, yes[2]!, no[2]!],
    },
  };
}

/** One-line confirmation shown before signing. `avgPrice` = USDC paid per token (fee included). */
export function buyMessage(side: "yes" | "no", tokens: number, avgPrice: number): string {
  const p = cents(avgPrice);
  const n = tokens >= 100 ? Math.round(tokens) : Math.round(tokens * 100) / 100;
  return `Buying ~${n} ${side.toUpperCase()} at ≈${p}. 2% fee included.`;
}
