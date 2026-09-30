"use client";

import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useConnection } from "@solana/wallet-adapter-react";
import {
  ACCOUNT_SIZES,
  refreshVaultGroupView,
  vaultGroupView,
  type VaultGroupLegView,
  type VaultGroupView,
} from "@pm-amm/sdk";
import { getClient } from "@/lib/pm-amm-client";
import { loadList, useRefetchWhenMissing } from "@/lib/cached-list";

export type VaultGroupLeg = VaultGroupLegView;
/** Display row for a multi-outcome commitment vault — built by the SDK's `vaultGroupView`. */
export type VaultGroupData = VaultGroupView;

const QUERY_KEY = ["vault_groups"];

export function useVaultGroups() {
  const { connection } = useConnection();
  const queryClient = useQueryClient();
  return useQuery<VaultGroupData[]>({
    queryKey: QUERY_KEY,
    queryFn: () =>
      loadList({
        queryClient,
        queryKey: QUERY_KEY,
        path: "/api/vault-groups",
        field: "vaultGroups",
        refresh: (v) => refreshVaultGroupView(v, Math.floor(Date.now() / 1000)),
        direct: async () => {
          const client = getClient(connection);
          const accounts = await client.fetchAllVaultGroups(ACCOUNT_SIZES.commitmentVaultGroup);
          const now = Math.floor(Date.now() / 1000);
          return accounts.map((acc) => vaultGroupView(acc.publicKey.toBase58(), acc.account, now));
        },
      }),
    refetchInterval: 10_000,
  });
}

export function useVaultGroup(vaultId: number | undefined) {
  const { data: vaults, ...rest } = useVaultGroups();
  const vault = useMemo(() => {
    if (vaultId === undefined || !vaults) return undefined;
    return vaults.find((v) => v.vaultId === vaultId);
  }, [vaults, vaultId]);
  useRefetchWhenMissing(vaultId !== undefined && !!vaults && !vault, rest.refetch);
  return { data: vault, ...rest };
}
