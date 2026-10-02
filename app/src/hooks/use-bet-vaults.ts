"use client";

import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { betVaultView, type BetVaultView } from "@pm-amm/sdk";
import { getClient } from "@/lib/pm-amm-client";
import { loadList, useRefetchWhenMissing } from "@/lib/cached-list";
import type { MyBet } from "@/lib/bets";

const QUERY_KEY = ["bet_vaults"];

/** All bet vaults — keeper cache first, direct RPC fallback (see cached-list). */
export function useBetVaults() {
  const { connection } = useConnection();
  const queryClient = useQueryClient();
  return useQuery<BetVaultView[]>({
    queryKey: QUERY_KEY,
    queryFn: () =>
      loadList({
        queryClient,
        queryKey: QUERY_KEY,
        path: "/api/bets",
        field: "betVaults",
        refresh: (v) => v,
        direct: async () => {
          const rows = await getClient(connection).fetchAllBetVaults();
          return rows.map((a) => betVaultView(a.publicKey.toBase58(), a.account));
        },
      }),
    refetchInterval: 10_000,
  });
}

export function useBetVault(vaultId: number | undefined) {
  const { data: vaults, ...rest } = useBetVaults();
  const vault = useMemo(
    () => (vaultId === undefined ? undefined : vaults?.find((v) => v.vaultId === vaultId)),
    [vaults, vaultId],
  );
  useRefetchWhenMissing(vaultId !== undefined && !!vaults && !vault, rest.refetch);
  return { data: vault, ...rest };
}

/** The connected wallet's stake in a bet (null: none, or already claimed/refunded). */
export function useMyBet(betVault: string | undefined) {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  return useQuery<MyBet | null>({
    queryKey: ["bet-position", betVault, publicKey?.toBase58()],
    enabled: !!betVault && !!publicKey,
    queryFn: async () => {
      const pos = await getClient(connection).fetchBetPosition(
        new PublicKey(betVault!),
        publicKey!,
      );
      if (!pos) return null;
      return { yes: Number(pos.yesAmount.toString()), no: Number(pos.noAmount.toString()) };
    },
    refetchInterval: 15_000,
  });
}
