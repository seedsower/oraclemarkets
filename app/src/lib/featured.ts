"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FEATURED_AUTHORITIES, HAS_FEATURED } from "@/lib/featured-list";
import type { VaultData } from "@/hooks/use-vaults";

/**
 * Curated default list. Anyone can create markets on the shared program, so
 * when NEXT_PUBLIC_FEATURED_AUTHORITIES (comma-separated pubkeys) is set the
 * lists default to rows created by those authorities; "All markets" shows the
 * rest with a "community" badge. Unset → everything is shown, as before.
 */
export { FEATURED_AUTHORITIES, HAS_FEATURED };

const STORAGE_KEY = "oracle:showAllMarkets";

/** Anything listable: its on-chain authority and its own address. */
export interface Curatable {
  authority: string;
  publicKey: string;
}

export interface Curation {
  /** False when no featured list is configured (show everything, no toggle). */
  enabled: boolean;
  showAll: boolean;
  setShowAll: (v: boolean) => void;
  /** Not created by a featured authority (only meaningful when `enabled`). */
  isCommunity: (item: Curatable) => boolean;
  /** Rows to display under the current toggle. */
  curate: <T extends Curatable>(items: T[] | undefined) => T[] | undefined;
}

/**
 * `vaults` lets a market launched from a featured creator's binary vault count
 * as featured: the launch sets `market.authority` to whoever paid for the
 * launch (permissionless), not to the vault's creator.
 */
export function useCuration(vaults: VaultData[] | undefined): Curation {
  const [showAll, setShowAllState] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) === "1") setShowAllState(true);
    } catch {
      // Storage blocked (private mode, previews) — default view is fine.
    }
  }, []);

  const setShowAll = useCallback((v: boolean) => {
    setShowAllState(v);
    try {
      localStorage.setItem(STORAGE_KEY, v ? "1" : "0");
    } catch {
      // Non-persistent is acceptable.
    }
  }, []);

  const featuredVaultMarkets = useMemo(
    () =>
      new Set(
        (vaults ?? []).filter((v) => FEATURED_AUTHORITIES.has(v.authority)).map((v) => v.market),
      ),
    [vaults],
  );

  const isCommunity = useCallback(
    (item: Curatable) =>
      HAS_FEATURED &&
      !FEATURED_AUTHORITIES.has(item.authority) &&
      !featuredVaultMarkets.has(item.publicKey),
    [featuredVaultMarkets],
  );

  const curate = useCallback(
    <T extends Curatable>(items: T[] | undefined) =>
      !HAS_FEATURED || showAll || !items ? items : items.filter((it) => !isCommunity(it)),
    [showAll, isCommunity],
  );

  return useMemo(
    () => ({ enabled: HAS_FEATURED, showAll, setShowAll, isCommunity, curate }),
    [showAll, setShowAll, isCommunity, curate],
  );
}
