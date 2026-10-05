import { NextResponse, type NextRequest } from "next/server";
import {
  accessToken,
  sign,
  verify,
  SESSION_COOKIE,
  SESSION_SECS,
  TEMP_COOKIE,
} from "@/lib/server/x-auth";
import { BRAND } from "@/lib/brand";

const SITE_URL = BRAND.siteUrl.replace(/\/$/, "");

/** X redirects back here: check it's our request token, then start a session. */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const fail = (why: string) => {
    const res = NextResponse.redirect(`${SITE_URL}/wallet?error=${why}`);
    res.cookies.delete({ name: TEMP_COOKIE, path: "/api/auth/x" });
    return res;
  };
  if (q.get("denied")) return fail("denied");
  const tmp = verify<{ key: string; secret: string; exp: number }>(
    req.cookies.get(TEMP_COOKIE)?.value,
  );
  const token = q.get("oauth_token");
  const verifier = q.get("oauth_verifier");
  if (!tmp || tmp.exp < Date.now() || !token || token !== tmp.key || !verifier)
    return fail("expired");
  try {
    const who = await accessToken(tmp, verifier);
    const res = NextResponse.redirect(`${SITE_URL}/wallet`);
    res.cookies.delete({ name: TEMP_COOKIE, path: "/api/auth/x" });
    res.cookies.set(
      SESSION_COOKIE,
      sign({ uid: who.userId, handle: who.handle, iat: Math.floor(Date.now() / 1000) }),
      { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: SESSION_SECS },
    );
    return res;
  } catch (e) {
    console.error("x callback failed", e instanceof Error ? e.message : e);
    return fail("login");
  }
}
