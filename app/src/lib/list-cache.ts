import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";

/**
 * Redis keys the keeper writes (see workers/keeper/src/cache.ts — keep in sync).
 * Each value is JSON `{ updatedAt: <unix ms>, items: [...] }` with EX 120.
 */
export const LIST_CACHE = {
  markets: "cache:markets",
  groups: "cache:groups",
  vaults: "cache:vaults",
  vaultGroups: "cache:vault_groups",
} as const;

interface CachedList {
  updatedAt: number;
  items: unknown[];
}

function parse(raw: string | null): CachedList | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<CachedList>;
    return typeof v.updatedAt === "number" && Array.isArray(v.items)
      ? { updatedAt: v.updatedAt, items: v.items }
      : null;
  } catch {
    return null;
  }
}

/**
 * `GET /api/<list>` body: `{ [field]: rows, updatedAt }`, or 503 when the
 * keeper hasn't written (or Redis is down) — clients then read the RPC.
 */
export async function serveCachedList(key: keyof typeof LIST_CACHE): Promise<NextResponse> {
  let cached: CachedList | null = null;
  try {
    cached = redis ? parse(await redis.get(LIST_CACHE[key])) : null;
  } catch {
    // Redis unreachable — same as an empty cache.
  }
  if (!cached) {
    return NextResponse.json(
      { error: "cache empty", updatedAt: null },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  return NextResponse.json(
    { [key]: cached.items, updatedAt: cached.updatedAt },
    { headers: { "Cache-Control": "public, s-maxage=5, stale-while-revalidate=10" } },
  );
}
