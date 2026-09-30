"use client";

import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useConnection } from "@solana/wallet-adapter-react";
import type { MarketData } from "@/hooks/use-markets";
import { ACCOUNT_SIZES, groupView, joinGroupLegs, type GroupView } from "@pm-amm/sdk";
import { getClient } from "@/lib/pm-amm-client";
import { loadList, useRefetchWhenMissing } from "@/lib/cached-list";

/** Display row for a group market — built by the SDK's `groupView` (shared with the keeper). */
export type GroupData = GroupView;

/**
 * Fetch all GroupMarket accounts and join each with its leg Market data.
 *
 * `markets` is passed in (from useMarkets) rather than re-fetched so the leg
 * price + reserves stay in sync with the rest of the UI on a single 10s tick
 * (cached groups are re-joined against these rows too).
 */
export function useGroups(markets: MarketData[] | undefined) {
  const { connection } = useConnection();
  const queryClient = useQueryClient();

  const marketByPubkey = useMemo(
    () => new Map((markets ?? []).map((m) => [m.publicKey, m])),
    [markets],
  );
  const queryKey = ["groups", markets?.length ?? 0];

  return useQuery<GroupData[]>({
    queryKey,
    enabled: markets !== undefined,
    queryFn: () =>
      loadList({
        queryClient,
        queryKey,
        path: "/api/groups",
        field: "groups",
        refresh: (g) => joinGroupLegs(g, marketByPubkey),
        direct: async () => {
          const fetched = await getClient(connection).fetchAllGroups(ACCOUNT_SIZES.groupMarket);
          return fetched.map((acc) =>
            groupView(acc.publicKey.toBase58(), acc.account, marketByPubkey),
          );
        },
      }),
    refetchInterval: 10_000,
  });
}

/** Filter to groups owned by `authority` that are unresolved and missing legs. */
export function useIncompleteUserGroups(
  authority: string | undefined,
  markets: MarketData[] | undefined,
): GroupData[] {
  const { data: groups } = useGroups(markets);
  return useMemo(() => {
    if (!authority || !groups) return [];
    return groups.filter((g) => g.authority === authority && g.isIncomplete);
  }, [authority, groups]);
}

/** Fetch a single group by groupId, with its resolved legs. */
export function useGroup(groupId: number | bigint | undefined, markets: MarketData[] | undefined) {
  const { data: groups, ...rest } = useGroups(markets);
  const group = useMemo(() => {
    if (groupId === undefined || !groups) return undefined;
    const target = BigInt(groupId);
    return groups.find((g) => BigInt(g.groupId) === target);
  }, [groups, groupId]);
  useRefetchWhenMissing(groupId !== undefined && !!groups && !group, rest.refetch);

  return { data: group, ...rest };
}
