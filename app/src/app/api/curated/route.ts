import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";

export const dynamic = "force-dynamic";

/**
 * GET → markets the curator opened from oraclemarkets.io questions:
 * `all` (Redis hash market:source) and `featured` (still in their category's
 * top N; set curator:featured). Powers /markets?category=oracle.
 */
export async function GET() {
  let all: string[] = [];
  let featured: string[] = [];
  try {
    if (redis) {
      all = Object.keys(await redis.hgetall("market:source"));
      featured = await redis.smembers("curator:featured");
    }
  } catch {
    // Redis down → nothing curated shown.
  }
  return NextResponse.json(
    { all, featured },
    { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } },
  );
}
