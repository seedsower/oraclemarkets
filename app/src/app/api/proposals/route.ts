import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";

export const dynamic = "force-dynamic";

/** Shape written by workers/xbot (store.ts `Proposal`). */
export interface XProposal {
  id: string;
  question: string;
  by: string;
  deadline: string | null;
  handle: string;
  tweetUrl: string;
  createdAt: number;
}

const LIMIT = 100;

/**
 * Market ideas people proposed by mentioning the bot ("propose <q> by <date>"),
 * newest first. Read-only: they came from public posts. Listing is an admin
 * decision made in /admin → /create; nothing is ever created automatically.
 */
export async function GET() {
  if (!redis) return NextResponse.json({ proposals: [] });
  try {
    const ids = (await redis.zrange("proposals:index", -LIMIT, -1)).reverse();
    const rows = await Promise.all(ids.map((id) => redis!.get(`proposals:${id}`)));
    const proposals = rows
      .map((r) => {
        try {
          return r ? (JSON.parse(r) as XProposal) : null;
        } catch {
          return null;
        }
      })
      .filter((p): p is XProposal => p !== null);
    return NextResponse.json(
      { proposals },
      { headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } },
    );
  } catch {
    return NextResponse.json({ proposals: [] });
  }
}
