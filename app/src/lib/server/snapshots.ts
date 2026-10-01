import { PublicKey } from "@solana/web3.js";
import {
  deriveGroupPda,
  deriveMarketPda,
  groupView,
  marketView,
  refreshMarketView,
  type GroupView,
  type MarketView,
} from "@pm-amm/sdk";
import { PROGRAM_ID, USDC_MINT } from "@/lib/constants";
import { FEATURED_AUTHORITIES } from "@/lib/featured-list";
import { LIST_CACHE } from "@/lib/list-cache";
import { redis } from "@/lib/redis";
import { serverClient } from "@/lib/server/chain";

/**
 * Single market / group lookups for server rendering (metadata, OG images,
 * Actions). Keeper cache first; one direct RPC read as the fallback.
 */
const nowSecs = () => Math.floor(Date.now() / 1000);

async function cachedRows<T>(key: keyof typeof LIST_CACHE): Promise<T[] | null> {
  try {
    const raw = redis ? await redis.get(LIST_CACHE[key]) : null;
    if (!raw) return null;
    const items = (JSON.parse(raw) as { items?: unknown }).items;
    return Array.isArray(items) ? (items as T[]) : null;
  } catch {
    return null;
  }
}

/** Parses a route `[id]` into the numeric on-chain id, or null. */
export function parseId(id: string): number | null {
  if (!/^\d{1,16}$/.test(id)) return null;
  const n = Number(id);
  return Number.isSafeInteger(n) ? n : null;
}

export async function getMarketById(marketId: number): Promise<MarketView | null> {
  const rows = await cachedRows<MarketView>("markets");
  const hit = rows?.find((m) => m.marketId === marketId);
  if (hit) return refreshMarketView(hit, nowSecs());
  try {
    const pda = deriveMarketPda(PROGRAM_ID, marketId);
    const acc = await serverClient().fetchMarket(pda);
    return acc ? marketView(pda.toBase58(), acc, nowSecs()) : null;
  } catch {
    return null;
  }
}

async function fetchLegs(pubkeys: string[]): Promise<Map<string, MarketView>> {
  const client = serverClient();
  const now = nowSecs();
  const out = new Map<string, MarketView>();
  await Promise.all(
    pubkeys.map(async (pk) => {
      try {
        const acc = await client.fetchMarket(new PublicKey(pk));
        if (acc) out.set(pk, marketView(pk, acc, now));
      } catch {
        // Unreadable leg → rendered as missing.
      }
    }),
  );
  return out;
}

export async function getGroupById(groupId: number): Promise<GroupView | null> {
  const rows = await cachedRows<GroupView>("groups");
  const hit = rows?.find((g) => g.groupId === groupId);
  if (hit) return hit;
  try {
    const pda = deriveGroupPda(PROGRAM_ID, groupId);
    const acc = await serverClient().fetchGroup(pda);
    if (!acc) return null;
    const legPks = acc.legs.slice(0, acc.legCount).map((p) => p.toBase58());
    return groupView(pda.toBase58(), acc, await fetchLegs(legPks));
  } catch {
    return null;
  }
}

const DAY = 86_400;

/**
 * Change vs ~24h ago from keeper chart points (`market:<pk>:prices`). Needs at
 * least two points; the baseline is the last point at or before 24h ago, else
 * the oldest point inside the window. Null when unknown.
 */
export async function priceChange24h(m: MarketView): Promise<number | null> {
  if (!redis) return null;
  try {
    const raw = await redis.zrange(`market:${m.publicKey}:prices`, 0, -1, { withScores: true });
    if (raw.length < 2) return null;
    const cutoff = nowSecs() - DAY;
    const before = raw.filter((r) => r.score <= cutoff).pop();
    const base = before ?? raw.find((r) => r.score > cutoff);
    const p = base ? (JSON.parse(base.member) as { p?: number }).p : undefined;
    return typeof p === "number" ? m.price - p : null;
  } catch {
    return null;
  }
}

/**
 * Showcase market for the landing page: an active, liquid, standalone USDC
 * market — preferring featured authorities, then the deepest pool. Cache only
 * (no RPC on the landing page); null when the keeper hasn't written yet.
 */
export async function getShowcaseMarket(): Promise<MarketView | null> {
  const rows = await cachedRows<MarketView>("markets");
  if (!rows) return null;
  const now = nowSecs();
  const live = rows.filter(
    (m) =>
      !m.resolved &&
      !m.group &&
      m.endTs > now + 3_600 &&
      m.lEff > 0 &&
      m.reserveYes > 0 &&
      m.collateralMint === USDC_MINT.toBase58(),
  );
  const featured = live.filter((m) => FEATURED_AUTHORITIES.has(m.authority));
  const pool = (featured.length ? featured : live).sort((a, b) => b.lZero - a.lZero);
  return pool[0] ? refreshMarketView(pool[0], now) : null;
}
