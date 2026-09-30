"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useConnection } from "@solana/wallet-adapter-react";
import { ACCOUNT_SIZES, marketView, refreshMarketView, type MarketView } from "@pm-amm/sdk";
import { getClient } from "@/lib/pm-amm-client";
import { loadList } from "@/lib/cached-list";

/** Display row for a binary market — built by the SDK's `marketView` (shared with the keeper). */
export type MarketData = MarketView;

const QUERY_KEY = ["markets"];

export function useMarkets() {
  const { connection } = useConnection();
  const queryClient = useQueryClient();

  return useQuery<MarketData[]>({
    queryKey: QUERY_KEY,
    queryFn: () =>
      loadList({
        queryClient,
        queryKey: QUERY_KEY,
        path: "/api/markets",
        field: "markets",
        refresh: (m) => refreshMarketView(m, Math.floor(Date.now() / 1000)),
        direct: async () => {
          // Filter by the current Market account size to skip any old-layout
          // accounts left over from earlier devnet deploys.
          const fetched = await getClient(connection).fetchAllMarkets(ACCOUNT_SIZES.market);
          const now = Math.floor(Date.now() / 1000);
          return fetched.map((acc) => marketView(acc.publicKey.toBase58(), acc.account, now));
        },
      }),
    refetchInterval: 10_000,
  });
}
