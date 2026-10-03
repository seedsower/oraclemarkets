import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { categoryMessage, isCategory } from "@/lib/categories";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { redis } from "@/lib/redis";
import {
  CATEGORY_MAX_SKEW_SECS,
  mayCategorize,
  verifyWalletSignature,
} from "@/lib/server/categories";

export const dynamic = "force-dynamic";

const KEY = "categories";

/** All categories: { account → slug }. Small; refreshed by clients every minute. */
export async function GET() {
  let categories: Record<string, string> = {};
  try {
    categories = redis ? await redis.hgetall(KEY) : {};
  } catch {
    // Redis down → everything shows as uncategorized.
  }
  return NextResponse.json(
    { categories },
    { headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=60" } },
  );
}

function isPubkey(v: unknown): v is string {
  try {
    return typeof v === "string" && new PublicKey(v).toBase58() === v;
  } catch {
    return false;
  }
}

/**
 * Set a category. Body: { account, category, signer, ts, signature } where
 * signature = wallet.signMessage(categoryMessage(account, category, ts)).
 * Only the account's on-chain authority (or an admin) may set it.
 */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const { account, category, signer, ts, signature } = b ?? {};
  if (!isPubkey(account) || !isPubkey(signer) || !isCategory(category)) {
    return NextResponse.json({ error: "Invalid account, signer or category." }, { status: 400 });
  }
  const now = Math.floor(Date.now() / 1000);
  if (
    typeof ts !== "number" ||
    Math.abs(ts - now) > CATEGORY_MAX_SKEW_SECS ||
    typeof signature !== "string"
  ) {
    return NextResponse.json({ error: "Signature expired — please try again." }, { status: 400 });
  }
  const limit = await rateLimit(`categories:${clientIp(req)}`, 30, 600);
  if (!limit.ok) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  if (!verifyWalletSignature(categoryMessage(account, category, ts), signature, signer)) {
    return NextResponse.json({ error: "Bad signature." }, { status: 401 });
  }
  if (!(await mayCategorize(account, signer))) {
    return NextResponse.json(
      { error: "Only the market's creator can set its category." },
      { status: 403 },
    );
  }
  if (!redis) return NextResponse.json({ error: "Storage not configured." }, { status: 503 });
  try {
    await redis.hset(KEY, account, category);
  } catch {
    return NextResponse.json({ error: "Storage unavailable — try again." }, { status: 503 });
  }
  return NextResponse.json({ ok: true, account, category });
}
