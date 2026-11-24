import { NextResponse } from "next/server";
import { getMarketMeta } from "@/lib/server/market-meta";

export const dynamic = "force-dynamic";

/** GET /api/market-meta/<account> → curated market details (or 404). */
export async function GET(_req: Request, { params }: { params: Promise<{ account: string }> }) {
  const { account } = await params;
  const meta = await getMarketMeta(account);
  if (!meta) {
    return NextResponse.json(
      { meta: null },
      { status: 404, headers: { "Cache-Control": "public, s-maxage=60" } },
    );
  }
  return NextResponse.json(
    { meta },
    { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600" } },
  );
}
