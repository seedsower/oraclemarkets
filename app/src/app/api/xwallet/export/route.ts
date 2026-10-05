import { NextResponse, type NextRequest } from "next/server";
import { Keypair } from "@solana/web3.js";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { readSession, SESSION_COOKIE } from "@/lib/server/x-auth";
import { base58, decryptSecret, walletRecord } from "@/lib/server/xwallet";
import { BRAND } from "@/lib/brand";

const SITE_URL = BRAND.siteUrl.replace(/\/$/, "");

/** Must have signed in with X within this window to export. */
const FRESH_SECS = 15 * 60;
const noStore = { "Cache-Control": "no-store" };

/**
 * POST → the owner's private key (base58, for Phantom/Solflare "import private
 * key"). Same-origin only, a recent sign-in, and a few per day.
 */
export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(SITE_URL).origin) {
    return NextResponse.json({ error: "bad origin" }, { status: 403, headers: noStore });
  }
  const s = readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!s)
    return NextResponse.json({ error: "sign in with X first" }, { status: 401, headers: noStore });
  if (Date.now() / 1000 - s.iat > FRESH_SECS) {
    return NextResponse.json({ error: "reauth" }, { status: 401, headers: noStore });
  }
  const limited = await rateLimit(`xwallet-export:${s.uid}`, 5, 86_400);
  const byIp = await rateLimit(`xwallet-export-ip:${clientIp(req)}`, 20, 86_400);
  if (!limited.ok || !byIp.ok) {
    return NextResponse.json(
      { error: "too many exports today" },
      { status: 429, headers: noStore },
    );
  }
  const rec = await walletRecord(s.uid);
  if (!rec) return NextResponse.json({ error: "no wallet yet" }, { status: 404, headers: noStore });
  const secret = decryptSecret(s.uid, rec.secret);
  if (Keypair.fromSecretKey(secret).publicKey.toBase58() !== rec.pubkey) {
    return NextResponse.json({ error: "key mismatch" }, { status: 500, headers: noStore });
  }
  console.info("xwallet export", { handle: s.handle, wallet: rec.pubkey });
  return NextResponse.json({ wallet: rec.pubkey, secretKey: base58(secret) }, { headers: noStore });
}
