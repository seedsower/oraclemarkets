import { NextResponse } from "next/server";
import { authenticateUrl, requestToken, sign, TEMP_COOKIE } from "@/lib/server/x-auth";
import { BRAND } from "@/lib/brand";

const SITE_URL = BRAND.siteUrl.replace(/\/$/, "");

/** Start "Sign in with X": get a request token, remember its secret, go to X. */
export async function GET() {
  try {
    const t = await requestToken(`${SITE_URL}/api/auth/x/callback`);
    const res = NextResponse.redirect(authenticateUrl(t.key));
    res.cookies.set(TEMP_COOKIE, sign({ ...t, exp: Date.now() + 10 * 60_000 }), {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/api/auth/x",
      maxAge: 600,
    });
    return res;
  } catch (e) {
    console.error("x login failed", e instanceof Error ? e.message : e);
    return NextResponse.redirect(`${SITE_URL}/wallet?error=login`);
  }
}
