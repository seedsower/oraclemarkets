"use client";

import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useConnection } from "@solana/wallet-adapter-react";
import { ACCOUNT_SIZES, refreshVaultView, vaultView, type VaultView } from "@pm-amm/sdk";
import { getClient } from "@/lib/pm-amm-client";
import { loadList, useRefetchWhenMissing } from "@/lib/cached-list";

/** Display row for a binary commitment vault — built by the SDK's `vaultView`. */
export type VaultData = VaultView;

const QUERY_KEY = ["vaults"];

export function useVaults() {
  const { connection } = useConnection();
  const queryClient = useQueryClient();
  return useQuery<VaultData[]>({
    queryKey: QUERY_KEY,
    queryFn: () =>
      loadList({
        queryClient,
        queryKey: QUERY_KEY,
        path: "/api/vaults",
        field: "vaults",
        refresh: (v) => refreshVaultView(v, Math.floor(Date.now() / 1000)),
        direct: async () => {
          const client = getClient(connection);
          const accounts = await client.fetchAllVaults(ACCOUNT_SIZES.commitmentVault);
          const now = Math.floor(Date.now() / 1000);
          return accounts.map((acc) => vaultView(acc.publicKey.toBase58(), acc.account, now));
        },
      }),
    refetchInterval: 10_000,
  });
}

export function useVault(vaultId: number | undefined) {
  const { data: vaults, ...rest } = useVaults();
  const vault = useMemo(() => {
    if (vaultId === undefined || !vaults) return undefined;
    return vaults.find((v) => v.vaultId === vaultId);
  }, [vaults, vaultId]);
  useRefetchWhenMissing(vaultId !== undefined && !!vaults && !vault, rest.refetch);
  return { data: vault, ...rest };
}
