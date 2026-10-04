"use client";

import { useCallback, useMemo } from "react";
import { errorMessage } from "@/lib/errors";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useWallet } from "@solana/wallet-adapter-react";
import { toast } from "sonner";
import { useBetVaults } from "@/hooks/use-bet-vaults";
import { useVaultGroups } from "@/hooks/use-vault-groups";
import { useVaults } from "@/hooks/use-vaults";
import {
  categoryLabel,
  categoryMessage,
  resolveCategory,
  type CategoryLinks,
  type CategorySlug,
} from "@/lib/categories";

const QUERY_KEY = ["categories"];

/** account → slug, from /api/categories. */
export function useCategoryMap() {
  return useQuery<Record<string, string>>({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const res = await fetch("/api/categories");
      return res.ok
        ? (((await res.json()) as { categories?: Record<string, string> }).categories ?? {})
        : {};
    },
    refetchInterval: 60_000,
    staleTime: 15_000,
  });
}

/** `categoryOf(account)` with vault → launched-market inheritance. */
export function useCategoryOf(): (account: string) => CategorySlug | null {
  const { data: map } = useCategoryMap();
  const { data: vaults } = useVaults();
  const { data: vaultGroups } = useVaultGroups();
  const { data: bets } = useBetVaults();
  const links = useMemo<CategoryLinks>(() => {
    const marketToVault = new Map<string, string>();
    for (const v of vaults ?? []) if (v.market) marketToVault.set(v.market, v.publicKey);
    for (const v of bets ?? []) if (v.market) marketToVault.set(v.market, v.publicKey);
    const groupToVault = new Map<string, string>();
    for (const v of vaultGroups ?? [])
      if (v.groupMarket) groupToVault.set(v.groupMarket, v.publicKey);
    return { marketToVault, groupToVault };
  }, [vaults, vaultGroups, bets]);
  return useCallback((account: string) => resolveCategory(account, map, links), [map, links]);
}

/**
 * Save a category for an account the connected wallet created: one free
 * `signMessage` (no transaction), verified server-side against the account's
 * on-chain authority. Resolves true on success.
 */
export function useSetCategory() {
  const { publicKey, signMessage } = useWallet();
  const queryClient = useQueryClient();
  return useCallback(
    async (account: string, slug: CategorySlug): Promise<boolean> => {
      if (!publicKey || !signMessage) {
        toast.error("This wallet can't sign messages", {
          description: "Set the category from the market page later.",
        });
        return false;
      }
      try {
        const ts = Math.floor(Date.now() / 1000);
        const sig = await signMessage(new TextEncoder().encode(categoryMessage(account, slug, ts)));
        const res = await fetch("/api/categories", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            account,
            category: slug,
            signer: publicKey.toBase58(),
            ts,
            signature: Buffer.from(sig).toString("base64"),
          }),
        });
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        await queryClient.invalidateQueries({ queryKey: QUERY_KEY });
        toast.success(`Category: ${categoryLabel(slug)}`);
        return true;
      } catch (e) {
        const msg = errorMessage(e);
        toast.error("Category not saved", {
          description: /reject/i.test(msg) ? "Cancelled in wallet" : msg,
        });
        return false;
      }
    },
    [publicKey, signMessage, queryClient],
  );
}
