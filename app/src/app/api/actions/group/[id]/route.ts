import type { NextRequest } from "next/server";
import {
  ACTIONS_CONFIG,
  actionError,
  actionJson,
  actionOptions,
  parseAmount,
} from "@/lib/server/actions/common";
import {
  groupActionGet,
  groupDisabledReason,
  tradableLegs,
} from "@/lib/server/actions/group-action";
import { buildBuyResponse } from "@/lib/server/actions/trade";
import { getGroupById, parseId } from "@/lib/server/snapshots";
import { absoluteUrl, groupPath } from "@/lib/share";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function load(ctx: Ctx) {
  const { id } = await ctx.params;
  const groupId = parseId(id);
  const group = groupId === null ? null : await getGroupById(groupId);
  if (!group) return null;
  const now = Math.floor(Date.now() / 1000);
  return {
    group,
    now,
    disabled: groupDisabledReason(group, now, { featuredOnly: ACTIONS_CONFIG.featuredOnly }),
    base: `/api/actions/group/${group.groupId}`,
    iconUrl: absoluteUrl(`${groupPath(group.groupId)}/opengraph-image`),
    pageUrl: absoluteUrl(groupPath(group.groupId)),
  };
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const l = await load(ctx);
  if (!l) return actionError("Market not found.", 404);
  return actionJson(groupActionGet(l.group, l));
}

/** POST ?leg=<slot index>&amount=N — buys YES on that leg's binary market. */
export async function POST(req: NextRequest, ctx: Ctx) {
  const l = await load(ctx);
  if (!l) return actionError("Market not found.", 404);
  if (l.disabled) return actionError(l.disabled);
  const legParam = req.nextUrl.searchParams.get("leg");
  const leg = tradableLegs(l.group, l.now).find((t) => String(t.index) === legParam);
  if (!leg) return actionError("Unknown or untradable outcome.");
  const amount = parseAmount(req.nextUrl.searchParams.get("amount"));
  if (amount === null) {
    return actionError(`Amount must be ${ACTIONS_CONFIG.minUsdc}–${ACTIONS_CONFIG.maxUsdc} USDC.`);
  }
  try {
    return await buildBuyResponse(req, {
      market: leg.market,
      side: "yes",
      amount,
      iconUrl: l.iconUrl,
      pageUrl: l.pageUrl,
    });
  } catch (e) {
    console.error("actions/group POST failed", e);
    return actionError("Couldn't build this trade right now. Please try again.", 500);
  }
}

export const OPTIONS = actionOptions;
