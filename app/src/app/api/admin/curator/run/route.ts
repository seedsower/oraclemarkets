import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { categoryAdmins } from "@/lib/categories";
import { curatorRunMessage, type CuratorRunState } from "@/lib/curator-run";
import { FEATURED_AUTHORITIES } from "@/lib/featured-list";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { redis } from "@/lib/redis";
import { CATEGORY_MAX_SKEW_SECS, verifyWalletSignature } from "@/lib/server/categories";

export const dynamic = "force-dynamic";

const REQUEST_KEY = "curator:run-request";
const STATUS_KEY = "curator:run-status";
/** A request the keeper hasn't picked up within an hour is dropped. */
const REQUEST_TTL_SECS = 3600;

/** CURATOR_ADMINS (server-only, comma-separated) + the category admins. */
function admins(): Set<string> {
  const extra = (process.env.CURATOR_ADMINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return new Set([...categoryAdmins(FEATURED_AUTHORITIES), ...extra]);
}

function isPubkey(v: unknown): v is string {
  try {
    return typeof v === "string" && new PublicKey(v).toBase58() === v;
  } catch {
    return false;
  }
}

function parse<T>(raw: string | null): T | null {
  try {
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/** GET → the pending request (if any) and the last trigger's outcome. */
export async function GET() {
  const state: CuratorRunState = { pending: null, last: null };
  try {
    if (redis) {
      state.pending = parse(await redis.get(REQUEST_KEY));
      state.last = parse(await redis.get(STATUS_KEY));
    }
  } catch {
    // Redis down → nothing known.
  }
  return NextResponse.json(state, { headers: { "Cache-Control": "no-store" } });
}

/**
 * POST { signer, ts, signature } — an admin wallet signs curatorRunMessage(ts).
 * Only enqueues: the keeper asks Railway to run the curator's cron job. The web
 * process never runs the curator itself.
 */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const { signer, ts, signature } = b ?? {};
  const now = Math.floor(Date.now() / 1000);
  const signerOk = isPubkey(signer);
  if (!signerOk || typeof ts !== "number" || typeof signature !== "string")
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  if (Math.abs(ts - now) > CATEGORY_MAX_SKEW_SECS)
    return NextResponse.json({ error: "Signature expired — try again." }, { status: 400 });
  const limit = await rateLimit(`curator-run:${clientIp(req)}`, 5, 3600);
  if (!limit.ok) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  const who = signer as string;
  if (!verifyWalletSignature(curatorRunMessage(ts), signature, who))
    return NextResponse.json({ error: "Bad signature." }, { status: 401 });
  if (!admins().has(who))
    return NextResponse.json(
      { error: "Only an admin wallet can run the curator." },
      { status: 403 },
    );
  if (!redis) return NextResponse.json({ error: "Storage not configured." }, { status: 503 });
  try {
    if (await redis.get(REQUEST_KEY))
      return NextResponse.json({ error: "A run is already queued." }, { status: 409 });
    const pending = { by: who, at: new Date().toISOString() };
    await redis.set(REQUEST_KEY, JSON.stringify(pending), { ex: REQUEST_TTL_SECS });
    return NextResponse.json({ ok: true, pending });
  } catch {
    return NextResponse.json({ error: "Storage unavailable — try again." }, { status: 503 });
  }
}
