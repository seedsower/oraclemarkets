import { PublicKey } from "@solana/web3.js";
import { betPhase, betVaultView, type BetVaultView, type PmAmmClient } from "@pm-amm/sdk";
import type { Command } from "./commands";
import type { BetsConfig, XbotConfig } from "./config";
import { log, errMsg } from "./log";
import type { Store } from "./store";
import type { Mention } from "./xapi";
import type { Claude } from "./claude";
import { stakeOnOpen, type MoneyCtx } from "./money";
import { stakeInBet } from "./money-commands";
import {
  applyRefinement,
  BET_REFUSED_REPLY,
  BET_RETRY_REPLY,
  BETS_BUSY_REPLY,
  BETS_OFF_REPLY,
  betExistingReply,
  betOpenedReply,
  planBet,
  windowLabel,
  type PendingBet,
} from "./betting";

type BetCmd = Extract<Command, { kind: "bet" }>;

export interface BetCtx {
  cfg: XbotConfig;
  store: Store;
  /** Signing client for the bot wallet; null when bets are off. */
  betClient: PmAmmClient | null;
  /** Rewrites the take into a settleable question + rules; null → the take as is. */
  claude: Claude | null;
  /** Custodial wallets: "bet? … I'll take YES $10" also stakes for the caller. */
  money: MoneyCtx | null;
}

/** Daily limits + a SOL floor so the hot wallet can't be drained by spam. */
async function capacity(ctx: BetCtx, b: BetsConfig, userId: string): Promise<string | null> {
  if ((await ctx.store.count("xbot:bets")) >= b.perDay) return BETS_BUSY_REPLY;
  if ((await ctx.store.count(`xbot:bets:user:${userId}`)) >= b.perUserPerDay) {
    return "You've opened your bets for today. Try again tomorrow.";
  }
  const lamports = await ctx.betClient!.connection.getBalance(b.wallet.publicKey);
  if (lamports < b.minLamports) {
    log.warn("bets paused: bot wallet low on SOL", {
      wallet: b.wallet.publicKey.toBase58(),
      lamports,
    });
    return BETS_BUSY_REPLY;
  }
  return null;
}

/**
 * Handle `bet?`: validate, dedupe per take, enforce limits, open the Bet Vault
 * (unless dry run) and return the reply. Stakes, launch odds and payouts are
 * all on-chain; this wallet can open and launch, never resolve.
 */
export interface BetReply {
  text: string;
  /** Set when the reply asks a follow-up; saved under the reply's id. */
  pending: PendingBet | null;
}

export async function handleBet(ctx: BetCtx, m: Mention, cmd: BetCmd): Promise<BetReply> {
  try {
    const r = await openBetFor(ctx, m, cmd);
    return typeof r === "string" ? { text: r, pending: null } : r;
  } catch (e) {
    // RPC / chain hiccup: say so instead of going silent (the mention is
    // already marked handled, so it won't be retried automatically).
    log.error("bet open failed", { by: m.username, error: errMsg(e) });
    return { text: BET_RETRY_REPLY, pending: null };
  }
}

async function openBetFor(ctx: BetCtx, m: Mention, cmd: BetCmd): Promise<string | BetReply> {
  const b = ctx.cfg.bets;
  if (!b || !ctx.betClient) return BETS_OFF_REPLY;
  const now = Math.floor(Date.now() / 1000);
  const planned = planBet(cmd, m, b, now);
  if (planned.action === "reply") {
    log.info("bet needs more info", { by: m.username, reply: planned.text });
    return { text: planned.text, pending: planned.pending ?? null };
  }
  const existing = await ctx.store.betForPost(planned.sourceId);
  if (existing) return betExistingReply(existing, ctx.cfg.siteUrl);
  const busy = await capacity(ctx, b, m.authorId);
  if (busy) {
    log.info("bet not opened", { by: m.username, reason: busy });
    return busy;
  }
  const refined = ctx.claude
    ? await ctx.claude.refineBet(planned.question, planned.deadline)
    : null;
  if (refined && !refined.allowed) {
    log.info("bet refused", { by: m.username, take: planned.question.slice(0, 80) });
    return BET_REFUSED_REPLY;
  }
  const plan = applyRefinement(planned, refined);

  const stakeWindow = windowLabel(plan.windowSecs);
  if (ctx.cfg.dryRun) {
    log.info("DRY RUN — would open bet", {
      name: plan.name,
      deadline: plan.deadline.toISOString(),
    });
    return betOpenedReply(plan.question, "<new>", plan.deadline, stakeWindow, ctx.cfg.siteUrl);
  }
  const { vaultId, betVaultPda, signature } = await ctx.betClient.send.createBetVault({
    name: plan.name,
    commitDurationSecs: plan.windowSecs,
    marketDurationSecs: plan.marketDurationSecs,
    minTotal: b.minTotalUsdc,
    lpBps: b.lpBps,
    resolver: b.resolver,
  });
  await recordBet(ctx, m, plan, vaultId, betVaultPda);
  log.info("opened bet", {
    vaultId,
    signature,
    by: m.username,
    name: plan.name,
    category: plan.category,
  });
  const take = ctx.money ? stakeInBet(m.text) : null;
  const staked = take ? await stakeOnOpen(ctx.money!, m, betVaultPda, take.side, take.usd) : "";
  return (
    betOpenedReply(plan.question, vaultId, plan.deadline, stakeWindow, ctx.cfg.siteUrl) + staked
  );
}

type OpenPlan = ReturnType<typeof applyRefinement>;

/** Off-chain record of a new bet: metadata for /bet/<id>, per-take dedupe, counters, category. */
async function recordBet(
  ctx: BetCtx,
  m: Mention,
  plan: OpenPlan,
  vaultId: number,
  betVaultPda: string,
) {
  await ctx.store.saveBet(
    {
      vaultId,
      question: plan.question,
      take: plan.take,
      rules: plan.rules,
      sourceUrl: plan.sourceUrl,
      openedBy: m.username || null,
      openerId: m.authorId || null,
      takeAuthorId: m.parent?.authorId ?? m.authorId ?? null,
      takeAuthor: m.parent?.username ?? m.username ?? null,
      deadline: plan.deadline.toISOString(),
      createdAt: Date.now(),
    },
    plan.sourceId,
  );
  await Promise.all([
    ctx.store.bump("xbot:bets"),
    ctx.store.bump(`xbot:bets:user:${m.authorId}`),
    // The launched market inherits this via the vault (web resolveCategory).
    plan.category ? ctx.store.setCategory(betVaultPda, plan.category) : Promise.resolve(0),
  ]);
}

/**
 * Keep the bot's bets moving (uses the keeper's cache, no extra list RPC):
 * launch when staking closes, settle once you've resolved. Both are safe to
 * retry; failures are logged and retried next pass.
 */
export async function advanceBets(ctx: BetCtx): Promise<void> {
  const b = ctx.cfg.bets;
  if (!b || !ctx.betClient || ctx.cfg.dryRun) return;
  const me = b.wallet.publicKey.toBase58();
  const now = Math.floor(Date.now() / 1000);
  const [rows, { markets }] = await Promise.all([ctx.store.betVaults(), ctx.store.snapshot()]);
  const resolved = new Set(markets.filter((x) => x.resolved).map((x) => x.publicKey));
  for (const cached of rows as unknown as BetVaultView[]) {
    if (cached.authority !== me) continue;
    const pending = betPhase(cached, now, resolved.has(cached.market));
    if (pending !== "launch-ready" && pending !== "settle-ready") continue;
    // The keeper's cache can lag a pass: confirm on-chain before acting.
    const fresh = await ctx.betClient.fetchBetVault(new PublicKey(cached.publicKey));
    if (!fresh) continue;
    const v = betVaultView(cached.publicKey, fresh);
    const phase = betPhase(v, now, resolved.has(v.market));
    try {
      if (phase === "launch-ready") {
        const r = await ctx.betClient.send.launchBetVault(new PublicKey(v.publicKey));
        log.info("launched bet", { vaultId: v.vaultId, marketId: r.marketId });
      } else if (phase === "settle-ready") {
        await ctx.betClient.send.settleBetVault(new PublicKey(v.publicKey));
        log.info("settled bet", { vaultId: v.vaultId });
      }
    } catch (e) {
      log.warn("bet step failed (retrying next pass)", {
        vaultId: v.vaultId,
        phase,
        error: errMsg(e),
      });
    }
  }
}
