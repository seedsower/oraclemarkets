import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/server/x-auth";
import { BRAND } from "@/lib/brand";

const SITE_URL = BRAND.siteUrl.replace(/\/$/, "");

export async function POST() {
  const res = NextResponse.redirect(`${SITE_URL}/wallet`, 303);
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
