"use client";

import { useQuery } from "@tanstack/react-query";
import type { MarketMeta } from "@/lib/server/market-meta";

/**
 * Attribution + full question for a market the curator opened from an
 * oraclemarkets.io question. Renders nothing for other markets.
 */
export function CuratedSource({ account, name }: { account: string; name: string }) {
  const { data: meta } = useQuery<MarketMeta | null>({
    queryKey: ["market-meta", account],
    queryFn: async () => {
      const res = await fetch(`/api/market-meta/${account}`);
      return res.ok ? ((await res.json()) as { meta: MarketMeta | null }).meta : null;
    },
    staleTime: 300_000,
  });
  if (!meta) return null;
  // The partner appends sub-question options ("… [Yes: 26,000 or above]"); not needed here.
  const full = (meta.question || meta.title).replace(/\s*\[[^\]]*\]\s*$/, "");
  const opened = meta.consensus === null ? null : Math.round(meta.consensus * 100);
  return (
    <div className="border border-line rounded-xl p-[16px] space-y-[10px] bg-surface/40">
      <p className="text-[11px] font-mono text-muted uppercase tracking-[0.08em]">
        {meta.attribution}
      </p>
      {full && full !== name && <p className="text-[14px] text-text-hi">{full}</p>}
      {opened !== null && (
        <p className="text-[12px] font-mono text-muted">
          Opened at the AI consensus: {opened}% YES
          {meta.aiNow !== null && (
            <>
              {" · "}AI now: {Math.round(meta.aiNow * 100)}% YES
              {meta.aiNowAt && ` (${meta.aiNowAt.slice(0, 10)})`}
            </>
          )}
        </p>
      )}
      {meta.criteria && (
        <details className="text-[12px] text-muted">
          <summary className="cursor-pointer font-mono hover:text-text-hi">
            Resolution criteria
          </summary>
          <p className="mt-[8px] whitespace-pre-line leading-relaxed">{meta.criteria}</p>
        </details>
      )}
      {meta.url && (
        <a
          href={meta.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block text-[12px] font-mono text-muted hover:text-text-hi transition-all duration-[120ms]"
        >
          AI forecasts on oraclemarkets.io ↗
        </a>
      )}
    </div>
  );
}
