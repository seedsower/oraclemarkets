import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";

export const dynamic = "force-dynamic";

interface PricePoint {
  t: number;
  p: number;
}

// Points are keeper-written and change at most every ~20 s; let the edge cache them.
const CACHE = { "Cache-Control": "public, s-maxage=10, stale-while-revalidate=30" };

function parsePoint(member: string): PricePoint | null {
  try {
    const v = JSON.parse(member) as Partial<PricePoint>;
    return typeof v.t === "number" && typeof v.p === "number" ? { t: v.t, p: v.p } : null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const marketId = req.nextUrl.searchParams.get("market");
  if (!marketId) {
    return NextResponse.json({ points: [] }, { status: 400 });
  }
  if (!redis) {
    return NextResponse.json({ points: [] }, { headers: CACHE });
  }

  const requested = Number(req.nextUrl.searchParams.get("limit") ?? 50);
  const limit = Number.isFinite(requested) ? Math.min(Math.max(Math.floor(requested), 1), 200) : 50;

  let points: PricePoint[] = [];
  try {
    const raw = await redis.zrange(`market:${marketId}:prices`, -limit, -1);
    points = raw.map(parsePoint).filter((p): p is PricePoint => p !== null);
  } catch {
    // Redis down → empty chart rather than a 500.
  }
  return NextResponse.json({ points }, { headers: CACHE });
}
