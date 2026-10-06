import { hasTopic, parseCommand, stripMentions, type Command } from "./commands";
import { mergeAssist, needsAssist, type Claude } from "./claude";
import type { XbotConfig } from "./config";
import { log } from "./log";
import {
  findMarket,
  marketsReply,
  notFoundReply,
  oddsReply,
  proposeHintReply,
  PROPOSE_REPLY,
} from "./replies";
import type { Store } from "./store";
import type { PmAmmClient } from "@pm-amm/sdk";
import { handleBet } from "./bet-actions";
import { followUpCommand, type PendingBet } from "./betting";
import { handleMoney, type MoneyCtx } from "./money";
import { parseMoney } from "./money-commands";
import { handleCall, parseCall } from "./calls";
import type { Mention, MentionSource } from "./xapi";

export interface BotCtx {
  cfg: XbotConfig;
  store: Store;
  source: MentionSource;
  /** Signing client for the bot wallet (bets); null when bets are off. */
  betClient: PmAmmClient | null;
  /** The bot account's user id (never reply to ourselves); null in fixture runs. */
  botUserId: string | null;
  /** Claude assist; null → rules only. */
  claude: Claude | null;
  /** Trading from X with custodial wallets (devnet); null when off. */
  money: MoneyCtx | null;
}

export type Outcome =
  | { action: "skipped"; reason: string }
  | { action: "replied" | "would-reply"; text: string; replyId?: string };

const nowSecs = () => Math.floor(Date.now() / 1000);

interface Plan {
  text: string;
  /** Set when this mention should be stored as a market proposal. */
  propose?: Extract<Command, { kind: "propose" }>;
}

/** Decide the reply (and whether to store a proposal) for a parsed command. */
async function plan(ctx: BotCtx, cmd: Exclude<Command, { kind: "bet" }>): Promise<Plan> {
  if (cmd.kind === "propose") return { text: PROPOSE_REPLY, propose: cmd };
  const { markets, groups } = await ctx.store.snapshot();
  const featured = (a: string) => ctx.cfg.featured.has(a);
  if (cmd.kind === "markets") {
    return { text: marketsReply(markets, featured, ctx.cfg.siteUrl, nowSecs()) };
  }
  const found = findMarket(cmd.query, markets, groups, featured, nowSecs());
  if (found) return { text: oddsReply(found, ctx.cfg.siteUrl, nowSecs()) };
  if (cmd.kind === "question" && cmd.isWill) {
    // "will btc reach 100k by december" with no market → keep it as a proposal.
    const asProposal = parseCommand(`propose ${cmd.query}`);
    if (asProposal?.kind === "propose" && asProposal.deadline) {
      return { text: PROPOSE_REPLY, propose: asProposal };
    }
    return { text: proposeHintReply(ctx.cfg.siteUrl) };
  }
  return { text: notFoundReply(cmd.query, ctx.cfg.siteUrl) };
}

async function saveProposal(ctx: BotCtx, m: Mention, cmd: Extract<Command, { kind: "propose" }>) {
  await ctx.store.saveProposal({
    id: m.id,
    question: cmd.question,
    by: cmd.by,
    deadline: cmd.deadline?.toISOString() ?? null,
    handle: m.username,
    authorId: m.authorId,
    tweetUrl: `https://x.com/${m.username || "i"}/status/${m.id}`,
    createdAt: Date.now(),
  });
}

/** The rules first; Claude only for free text, unparsed text or a bet without a date. */
async function readMention(ctx: BotCtx, m: Mention): Promise<Command | null> {
  const rule = parseCommand(m.text);
  if (!ctx.claude || !needsAssist(rule, hasTopic(stripMentions(m.text)))) return rule;
  return mergeAssist(rule, await ctx.claude.interpret(m.text, m.parent?.text ?? null));
}

interface Understood {
  cmd: Command | null;
  /** The mention, with `parent` set to the real take (never the bot's own post). */
  m: Mention;
  /** An answer to the bot's own follow-up ("Oct 4"): exempt from the cooldown. */
  followUp: boolean;
}

/** A reply to the bot's "pick a deadline" → the original bet with the new date. */
async function answerFollowUp(ctx: BotCtx, m: Mention, p: PendingBet): Promise<Understood> {
  let cmd = followUpCommand(m.text, p);
  if (!cmd.deadline && ctx.claude) {
    const ai = await ctx.claude.interpret(m.text, p.take?.text ?? p.question);
    if (ai?.kind === "bet" && ai.deadline) cmd = { ...cmd, by: ai.by, deadline: ai.deadline };
  }
  return { cmd, m: { ...m, parent: p.take }, followUp: true };
}

/** Replies to the bot's own posts are answers to its follow-ups, or have no take at all. */
async function understand(ctx: BotCtx, m: Mention): Promise<Understood> {
  const botId = ctx.botUserId ?? ctx.cfg.x?.botUserId ?? null;
  if (!botId || !m.parent || m.parent.authorId !== botId) {
    return { cmd: await readMention(ctx, m), m, followUp: false };
  }
  const pending = await ctx.store.pendingBet(m.parent.id);
  if (pending) return answerFollowUp(ctx, m, pending);
  const noTake = { ...m, parent: null };
  return { cmd: await readMention(ctx, noTake), m: noTake, followUp: false };
}

/**
 * One mention → at most one reply. Guards, in order: dedupe by tweet id, never
 * our own posts or retweets, a recognised command, one reply per user per
 * 10 min, the daily cap. Dry run logs the reply instead of sending it.
 */
export async function handleMention(ctx: BotCtx, raw: Mention): Promise<Outcome> {
  if (!(await ctx.store.markSeen(raw.id))) return { action: "skipped", reason: "already handled" };
  if (ctx.cfg.x && raw.authorId === ctx.cfg.x.botUserId)
    return { action: "skipped", reason: "own post" };
  if (/^RT @/i.test(raw.text)) return { action: "skipped", reason: "retweet" };
  // Result calls on bets ("resolve YES" / "dispute"): recorded for the resolver, never signed.
  const call = ctx.cfg.bets ? parseCall(stripMentions(raw.text)) : null;
  if (call) {
    if (await capReached(ctx)) return { action: "skipped", reason: "daily reply cap" };
    return deliver(ctx, raw, await handleCall(ctx.store, raw, call), call.kind, null);
  }
  // Money commands: fixed rules only, no cooldown (one at a time per user + daily limits).
  const money = ctx.money ? parseMoney(stripMentions(raw.text)) : null;
  if (money) {
    if (await capReached(ctx)) return { action: "skipped", reason: "daily reply cap" };
    const text = ctx.cfg.dryRun
      ? `(dry run) would run ${money.kind}`
      : await handleMoney(ctx.money!, raw, money);
    return deliver(ctx, raw, text, money.kind, null);
  }
  const { cmd, m, followUp } = await understand(ctx, raw);
  if (!cmd) return { action: "skipped", reason: "no command" };
  if (!(await ctx.store.takeCooldown(m.authorId)) && !followUp)
    return { action: "skipped", reason: "user cooldown" };
  const p: Plan = cmd.kind === "bet" ? { text: "" } : await plan(ctx, cmd);
  if (p.propose) await saveProposal(ctx, m, p.propose);
  if (await capReached(ctx)) return { action: "skipped", reason: "daily reply cap" };
  const bet = cmd.kind === "bet" ? await handleBet(ctx, m, cmd) : null;
  return deliver(ctx, m, bet ? bet.text : p.text, cmd.kind, bet?.pending ?? null, followUp);
}

const capReached = async (ctx: BotCtx) =>
  (await ctx.store.repliesToday(ctx.cfg.dryRun)) >= ctx.cfg.dailyReplyCap;

/** Count, then post (or log, in dry run) one reply; remember a follow-up question. */
async function deliver(
  ctx: BotCtx,
  m: Mention,
  text: string,
  command: string,
  pending: PendingBet | null,
  followUp = false,
): Promise<Outcome> {
  const dry = ctx.cfg.dryRun;
  await ctx.store.countReply(dry);
  if (dry) {
    log.info("DRY RUN — would reply", { to: m.username, inReplyTo: m.id, command, text });
    return { action: "would-reply", text };
  }
  const replyId = await ctx.source.reply(text, m.id);
  if (pending) await ctx.store.savePendingBet(replyId, pending);
  log.info("replied", { to: m.username, inReplyTo: m.id, command, replyId, followUp });
  return { action: "replied", text, replyId };
}
