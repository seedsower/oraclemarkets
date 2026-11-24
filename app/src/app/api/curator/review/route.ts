import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";

export const dynamic = "force-dynamic";

/** Shape written by workers/curator (lifecycle.ts `ReviewItem`). */
export interface CuratorReviewItem {
  market: string;
  questionId: string;
  kind: string;
  note: string;
  url: string;
  at: string;
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

/**
 * GET → curated markets whose partner question was resolved, voided or dropped
 * (Redis `curator:review`). Read-only: the curator never resolves; the market's
 * resolver decides in /admin. Entries clear themselves once the market resolves.
 */
export async function GET() {
  let items: CuratorReviewItem[] = [];
  try {
    const raw = redis ? await redis.hgetall("curator:review") : {};
    items = Object.values(raw).flatMap((v) => {
      try {
        const o = JSON.parse(v) as Record<string, unknown>;
        return [
          {
            market: str(o.market, 64),
            questionId: str(o.questionId, 200),
            kind: str(o.kind, 40),
            note: str(o.note, 400),
            url: /^https:\/\/(www\.)?oraclemarkets\.io\//.test(str(o.url, 500))
              ? str(o.url, 500)
              : "",
            at: str(o.at, 40),
          },
        ];
      } catch {
        return [];
      }
    });
  } catch {
    // Redis down → nothing to show.
  }
  items.sort((a, b) => a.at.localeCompare(b.at));
  return NextResponse.json(
    { items },
    { headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } },
  );
}
