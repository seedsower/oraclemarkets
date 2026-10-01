import type { NextRequest } from "next/server";
import {
  ACTIONS_CONFIG,
  actionError,
  actionJson,
  actionOptions,
  parseAmount,
  parseSide,
} from "@/lib/server/actions/common";
import {
  disabledReason,
  isFeaturedMarket,
  marketActionGet,
} from "@/lib/server/actions/market-action";
import { buildBuyResponse } from "@/lib/server/actions/trade";
import { getMarketById, parseId } from "@/lib/server/snapshots";
import { absoluteUrl, marketPath } from "@/lib/share";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function load(ctx: Ctx) {
  const { id } = await ctx.params;
  const marketId = parseId(id);
  const market = marketId === null ? null : await getMarketById(marketId);
  if (!market) return null;
  const now = Math.floor(Date.now() / 1000);
  const featured = ACTIONS_CONFIG.featuredOnly ? await isFeaturedMarket(market) : true;
  return {
    market,
    disabled: disabledReason(market, now, { featuredOnly: ACTIONS_CONFIG.featuredOnly, featured }),
    base: `/api/actions/market/${market.marketId}`,
    iconUrl: absoluteUrl(`${marketPath(market.marketId)}/opengraph-image`),
    pageUrl: absoluteUrl(marketPath(market.marketId)),
  };
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const l = await load(ctx);
  if (!l) return actionError("Market not found.", 404);
  return actionJson(marketActionGet(l.market, l));
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const l = await load(ctx);
  if (!l) return actionError("Market not found.", 404);
  if (l.disabled) return actionError(l.disabled);
  const side = parseSide(req.nextUrl.searchParams.get("side"));
  if (!side) return actionError("side must be yes or no.");
  const amount = parseAmount(req.nextUrl.searchParams.get("amount"));
  if (amount === null) {
    return actionError(`Amount must be ${ACTIONS_CONFIG.minUsdc}–${ACTIONS_CONFIG.maxUsdc} USDC.`);
  }
  try {
    return await buildBuyResponse(req, {
      market: l.market,
      side,
      amount,
      iconUrl: l.iconUrl,
      pageUrl: l.pageUrl,
    });
  } catch (e) {
    console.error("actions/market POST failed", e);
    return actionError("Couldn't build this trade right now. Please try again.", 500);
  }
}

export const OPTIONS = actionOptions;
