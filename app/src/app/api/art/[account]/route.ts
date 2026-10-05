import { getArt } from "@/lib/server/art";

/**
 * GET /api/art/<account> → the market's SVG illustration (or 404).
 * The SVG is sanitized when drawn; the CSP here also blocks scripts and any
 * loads if someone opens the URL directly.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ account: string }> }) {
  const { account } = await params;
  const svg = await getArt(account);
  if (!svg) {
    return new Response("no art", {
      status: 404,
      headers: { "Cache-Control": "public, s-maxage=60" },
    });
  }
  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
    },
  });
}
