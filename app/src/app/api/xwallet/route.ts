import { NextResponse, type NextRequest } from "next/server";
import { readSession, SESSION_COOKIE } from "@/lib/server/x-auth";
import { walletRecord } from "@/lib/server/xwallet";

/** The signed-in X user and their bot wallet address (null until they first trade from X). */
export async function GET(req: NextRequest) {
  const s = readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!s)
    return NextResponse.json({ signedIn: false }, { headers: { "Cache-Control": "no-store" } });
  const rec = await walletRecord(s.uid).catch(() => null);
  return NextResponse.json(
    { signedIn: true, handle: s.handle, wallet: rec?.pubkey ?? null, signedInAt: s.iat },
    { headers: { "Cache-Control": "no-store" } },
  );
}
