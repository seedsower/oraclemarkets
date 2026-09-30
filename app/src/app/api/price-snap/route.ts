import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { redis } from "@/lib/redis";

/**
 * Chart-point ingest for trusted writers only (the keeper writes to Redis
 * directly; this endpoint exists for out-of-process tools). Browsers never
 * post here — anyone could forge chart history otherwise.
 */
const MAX_SKEW_SECS = 600;
const MAX_POINTS = 500;
const MIN_GAP_SECS = 10;

/** Constant-time string compare (hash first so lengths always match). */
function secretMatches(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

function isPubkey(v: unknown): v is string {
  if (typeof v !== "string" || v.length < 32 || v.length > 44) return false;
  try {
    return new PublicKey(v).toBase58() === v;
  } catch {
    return false;
  }
}

interface Snap {
  marketId: string;
  price: number;
  timestamp: number;
  force: boolean;
}

function parseSnap(body: unknown): Snap | string {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!isPubkey(b.marketId)) return "marketId must be a base58 pubkey";
  const { price, timestamp } = b;
  if (typeof price !== "number" || !Number.isFinite(price) || price < 0 || price > 1) {
    return "price must be a number in [0, 1]";
  }
  const now = Math.floor(Date.now() / 1000);
  if (typeof timestamp !== "number" || Math.abs(timestamp - now) > MAX_SKEW_SECS) {
    return `timestamp must be unix seconds within ±${MAX_SKEW_SECS}s of server time`;
  }
  return { marketId: b.marketId, price, timestamp: Math.floor(timestamp), force: b.force === true };
}

export async function POST(req: Request) {
  const expected = process.env.KEEPER_SHARED_SECRET;
  if (!expected) {
    return NextResponse.json({ ok: false, error: "Ingest not configured" }, { status: 503 });
  }
  const given = req.headers.get("x-oracle-keeper-secret") ?? "";
  if (!secretMatches(given, expected)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!redis) {
    return NextResponse.json({ ok: false, error: "Redis not configured" }, { status: 503 });
  }

  const snap = parseSnap(await req.json().catch(() => null));
  if (typeof snap === "string") {
    return NextResponse.json({ ok: false, error: snap }, { status: 400 });
  }

  const key = `market:${snap.marketId}:prices`;
  try {
    if (!snap.force) {
      const [latest] = await redis.zrange(key, -1, -1, { withScores: true });
      if (latest && snap.timestamp - latest.score < MIN_GAP_SECS) {
        return NextResponse.json({ ok: true, skipped: true });
      }
    }
    await redis.zadd(key, snap.timestamp, JSON.stringify({ t: snap.timestamp, p: snap.price }));
    const count = await redis.zcard(key);
    if (count > MAX_POINTS) await redis.zremrangebyrank(key, 0, count - MAX_POINTS - 1);
  } catch {
    return NextResponse.json({ ok: false, error: "Redis unavailable" }, { status: 503 });
  }
  return NextResponse.json({ ok: true });
}
