import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import type { CallRecord } from "@/lib/bet-calls";

/** GET → { calls: { [betVault]: CallRecord } } — players' result calls (public X posts). */
export async function GET() {
  let calls: Record<string, CallRecord> = {};
  try {
    const raw = redis ? await redis.hgetall("bet:calls") : {};
    calls = Object.fromEntries(
      Object.entries(raw).map(([k, v]) => [k, JSON.parse(v) as CallRecord]),
    );
  } catch {
    // Redis down → no calls shown; resolving still works.
  }
  return NextResponse.json({ calls }, { headers: { "Cache-Control": "no-store" } });
}
