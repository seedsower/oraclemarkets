import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";

export const dynamic = "force-dynamic";

const SHOW = 10;

/**
 * GET → the curator's latest run reports (workers/curator/src/report.ts),
 * newest first. Read-only; the reports hold only public on-chain facts
 * (markets, signatures) and the partner's public questions.
 */
export async function GET() {
  let runs: unknown[] = [];
  try {
    if (redis) {
      const keys = (await redis.zrange("curator:runs", -SHOW, -1)).reverse();
      const raw = await Promise.all(keys.map((k) => redis!.get(k)));
      runs = raw.flatMap((r) => {
        try {
          return r ? [JSON.parse(r) as unknown] : [];
        } catch {
          return [];
        }
      });
    }
  } catch {
    // Redis down → nothing to show.
  }
  return NextResponse.json(
    { runs },
    { headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } },
  );
}
