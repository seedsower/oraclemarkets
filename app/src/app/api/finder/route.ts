import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";

/**
 * GET → { updatedAt, items } — debate candidates found by the X bot
 * (workers/xbot/src/finder.ts). Public X posts only; shown in /admin.
 */
export async function GET() {
  let body: { updatedAt: number | null; items: unknown[] } = { updatedAt: null, items: [] };
  try {
    const raw = redis ? await redis.get("finder:list") : null;
    if (raw) body = JSON.parse(raw);
  } catch {
    // Redis down → empty list.
  }
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
