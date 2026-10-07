import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";

/** GET → { updatedAt, rows } — built every 10 min by the X bot (workers/xbot/src/leaderboard.ts). */
export async function GET() {
  let body: { updatedAt: number | null; rows: unknown[] } = { updatedAt: null, rows: [] };
  try {
    const raw = redis ? await redis.get("leaderboard") : null;
    if (raw) body = JSON.parse(raw);
  } catch {
    // Redis down → empty board.
  }
  return NextResponse.json(body, {
    headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" },
  });
}
