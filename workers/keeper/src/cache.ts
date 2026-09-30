import IORedis from "ioredis";
import type { MarketView } from "@pm-amm/sdk";

/**
 * Redis layout shared with the web service (app/src/lib/list-cache.ts and
 * app/src/app/api/price-history — keep in sync).
 */
export const LIST_KEYS = {
  markets: "cache:markets",
  groups: "cache:groups",
  vaults: "cache:vaults",
  vaultGroups: "cache:vault_groups",
} as const;
export const UPDATED_AT_KEY = "cache:updated_at";
/** Lists expire if the keeper stops, so the web falls back to RPC. */
const LIST_TTL_SECS = 120;

const priceKey = (market: string) => `market:${market}:prices`;
const MAX_POINTS = 500;
/** Record a point when the price moved this much (absolute, 0.2%) … */
const MIN_PRICE_DELTA = 0.002;
/** … or when this long passed since the last point. */
const HEARTBEAT_SECS = 300;

type Multi = ReturnType<IORedis["multi"]>;

/** MULTI/EXEC reports per-command errors in the reply instead of throwing. */
async function execOrThrow(m: Multi): Promise<void> {
  const replies = await m.exec();
  const failed = replies?.find(([err]) => err);
  if (!replies || failed) throw failed?.[0] ?? new Error("redis transaction aborted");
}

export function connectRedis(url: string): IORedis {
  const redis = new IORedis(url, {
    maxRetriesPerRequest: 2,
    // Railway private networking resolves over IPv6; 0 = try both families.
    family: 0,
    protocol: 2,
  });
  redis.on("error", () => {}); // surfaced by the failing command instead
  return redis;
}

export async function writeList(
  redis: IORedis,
  key: keyof typeof LIST_KEYS,
  items: unknown[],
  updatedAt: number,
): Promise<void> {
  const body = JSON.stringify({ updatedAt, items });
  await execOrThrow(
    redis
      .multi()
      .set(LIST_KEYS[key], body, "EX", LIST_TTL_SECS)
      .set(UPDATED_AT_KEY, String(updatedAt), "EX", LIST_TTL_SECS),
  );
}

interface LastPoint {
  t: number;
  p: number;
}

/** Last recorded point per market; seeded from Redis the first time a market is seen. */
const lastPoints = new Map<string, LastPoint>();

async function lastPoint(redis: IORedis, market: string): Promise<LastPoint | null> {
  const cached = lastPoints.get(market);
  if (cached) return cached;
  const [member] = await redis.zrange(priceKey(market), -1, "-1");
  if (!member) return null;
  try {
    const v = JSON.parse(member) as LastPoint;
    lastPoints.set(market, v);
    return v;
  } catch {
    return null;
  }
}

/** Unresolved, unexpired markets with liquidity — the ones whose price can move. */
export function isChartable(m: MarketView, now: number): boolean {
  return !m.resolved && now < m.endTs && m.lEff > 0;
}

/** Append `{t, p}` if the price moved ≥ 0.2% or 5 min passed. Returns true if written. */
export async function recordPrice(redis: IORedis, m: MarketView, now: number): Promise<boolean> {
  const last = await lastPoint(redis, m.publicKey);
  if (last && Math.abs(m.price - last.p) < MIN_PRICE_DELTA && now - last.t < HEARTBEAT_SECS) {
    return false;
  }
  const point = { t: now, p: m.price };
  await execOrThrow(
    redis
      .multi()
      .zadd(priceKey(m.publicKey), now, JSON.stringify(point))
      // Keep the newest MAX_POINTS members.
      .zremrangebyrank(priceKey(m.publicKey), 0, -(MAX_POINTS + 1)),
  );
  lastPoints.set(m.publicKey, point);
  return true;
}
