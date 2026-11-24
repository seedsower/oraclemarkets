"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useMarkets } from "@/hooks/use-markets";
import type { CuratorReviewItem } from "@/app/api/curator/review/route";

const LABEL: Record<string, string> = {
  "partner-resolved": "Partner resolved",
  "partner-void": "Partner voided",
  "partner-gone": "No longer listed",
};

/**
 * Admin: curated markets whose oraclemarkets.io question is no longer active.
 * The curator only flags them; the market's resolver (the curator wallet)
 * checks the source and resolves in the market list above.
 */
export function CuratorReview() {
  const { data } = useQuery({
    queryKey: ["curator-review"],
    queryFn: async (): Promise<CuratorReviewItem[]> =>
      ((await (await fetch("/api/curator/review")).json()) as { items: CuratorReviewItem[] }).items,
    refetchInterval: 60_000,
  });
  const { data: markets } = useMarkets();
  if (!data || data.length === 0)
    return <p className="text-[12px] text-muted font-mono">Nothing to review.</p>;
  return (
    <div className="space-y-[12px]">
      {data.map((i) => {
        const m = markets?.find((x) => x.publicKey === i.market);
        return (
          <div key={i.market} className="border border-line rounded-xl p-[14px] space-y-[6px]">
            <div className="flex items-center gap-[10px] flex-wrap">
              <span className="text-[11px] font-mono text-no uppercase tracking-[0.06em]">
                {LABEL[i.kind] ?? i.kind}
              </span>
              {m ? (
                <Link
                  href={`/market/${m.marketId}`}
                  className="text-[14px] text-text-hi hover:underline"
                >
                  {m.name}
                </Link>
              ) : (
                <span className="text-[12px] font-mono text-muted">{i.market}</span>
              )}
            </div>
            <p className="text-[12px] text-muted">{i.note}</p>
            {i.url && (
              <a
                href={i.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[12px] font-mono text-muted hover:text-text-hi"
              >
                Partner question ↗
              </a>
            )}
          </div>
        );
      })}
    </div>
  );
}
