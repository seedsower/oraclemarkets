"use client";

import { useQuery } from "@tanstack/react-query";

/** Markets opened by the curator (/api/curated): `featured` = still in their category's top N. */
export function useCurated() {
  return useQuery<{ all: string[]; featured: string[] }>({
    queryKey: ["curated"],
    queryFn: async () => {
      const res = await fetch("/api/curated");
      return res.ok
        ? ((await res.json()) as { all: string[]; featured: string[] })
        : { all: [], featured: [] };
    },
    staleTime: 60_000,
  });
}
