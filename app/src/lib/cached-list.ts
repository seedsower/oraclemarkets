"use client";

import { useEffect } from "react";
import type { QueryClient, QueryKey } from "@tanstack/react-query";

/**
 * Keeper-cache-first list loading. The keeper service snapshots every list
 * account into Redis; `/api/{markets,groups,vaults,vault-groups}` serve it, so
 * a page load costs one small HTTP GET instead of a `getProgramAccounts` per
 * list per visitor. The direct RPC read stays as the fallback — and as the
 * primary path right after the user's own transaction, which the keeper won't
 * have seen yet.
 */

/** Cache older than this is ignored (keeper interval is ~20 s). */
const MAX_AGE_MS = 90_000;
/** After a user tx / missing item, read straight from RPC for this long. */
const DIRECT_WINDOW_MS = 60_000;
/** After the cache endpoint fails, don't retry it for this long. */
const CACHE_BACKOFF_MS = 60_000;

let directUntil = 0;
const cacheDownUntil = new Map<string, number>();

/** Read lists straight from the RPC for a while (the keeper lags fresh writes). */
export function preferDirectRpc(ms = DIRECT_WINDOW_MS): void {
  directUntil = Math.max(directUntil, Date.now() + ms);
}

async function fetchCached<T>(path: string, field: string): Promise<T[] | null> {
  if (Date.now() < (cacheDownUntil.get(path) ?? 0)) return null;
  try {
    const res = await fetch(path);
    if (res.ok) {
      const body = (await res.json()) as Record<string, unknown> & { updatedAt?: number };
      const items = body[field];
      const fresh = typeof body.updatedAt === "number" && Date.now() - body.updatedAt < MAX_AGE_MS;
      if (Array.isArray(items) && fresh) return items as T[];
    }
  } catch {
    // Network error — fall through to backoff + RPC.
  }
  cacheDownUntil.set(path, Date.now() + CACHE_BACKOFF_MS);
  return null;
}

interface LoadListOptions<T> {
  queryClient: QueryClient;
  queryKey: QueryKey;
  /** `/api/...` endpoint and the response field holding the rows. */
  path: string;
  field: string;
  /** Direct RPC read (the pre-keeper code path). */
  direct: () => Promise<T[]>;
  /** Recompute time-dependent fields of cached rows for the viewer's clock. */
  refresh: (row: T) => T;
}

/**
 * Cache first, RPC fallback. An explicit `invalidateQueries` (how every tx
 * flow refreshes after sending) bypasses the cache and opens the direct
 * window, so a user's trade shows up immediately and doesn't flip back to the
 * pre-trade snapshot on the next poll.
 */
export async function loadList<T>(o: LoadListOptions<T>): Promise<T[]> {
  if (o.queryClient.getQueryState(o.queryKey)?.isInvalidated) preferDirectRpc();
  if (Date.now() >= directUntil) {
    const cached = await fetchCached<T>(o.path, o.field);
    if (cached) return cached.map(o.refresh);
  }
  return o.direct();
}

/**
 * Detail pages: when the list loaded but doesn't contain the item (e.g. the
 * user just created it and the keeper hasn't indexed it), refetch from RPC.
 */
export function useRefetchWhenMissing(missing: boolean, refetch: () => unknown): void {
  useEffect(() => {
    if (!missing || Date.now() < directUntil) return;
    preferDirectRpc();
    refetch();
  }, [missing, refetch]);
}
