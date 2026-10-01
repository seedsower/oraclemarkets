import { parseCommand, type Command } from "./commands";
import type { XbotConfig } from "./config";
import { log } from "./log";
import { findMarket, marketsReply, notFoundReply, oddsReply, PROPOSE_REPLY } from "./replies";
import type { Store } from "./store";
import type { Mention, MentionSource } from "./xapi";

export interface BotCtx {
  cfg: XbotConfig;
  store: Store;
  source: MentionSource;
}

export type Outcome =
  | { action: "skipped"; reason: string }
  | { action: "replied" | "would-reply"; text: string; replyId?: string };

const nowSecs = () => Math.floor(Date.now() / 1000);

async function replyText(ctx: BotCtx, cmd: Command): Promise<string> {
  if (cmd.kind === "propose") return PROPOSE_REPLY;
  const { markets, groups } = await ctx.store.snapshot();
  const featured = (a: string) => ctx.cfg.featured.has(a);
  if (cmd.kind === "markets") return marketsReply(markets, featured, ctx.cfg.siteUrl, nowSecs());
  const found = findMarket(cmd.query, markets, groups, featured, nowSecs());
  return found
    ? oddsReply(found, ctx.cfg.siteUrl, nowSecs())
    : notFoundReply(cmd.query, ctx.cfg.siteUrl);
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

/**
 * One mention → at most one reply. Guards, in order: dedupe by tweet id, never
 * our own posts or retweets, a recognised command, one reply per user per
 * 10 min, the daily cap. Dry run logs the reply instead of sending it.
 */
export async function handleMention(ctx: BotCtx, m: Mention): Promise<Outcome> {
  if (!(await ctx.store.markSeen(m.id))) return { action: "skipped", reason: "already handled" };
  if (ctx.cfg.x && m.authorId === ctx.cfg.x.botUserId)
    return { action: "skipped", reason: "own post" };
  if (/^RT @/i.test(m.text)) return { action: "skipped", reason: "retweet" };
  const cmd = parseCommand(m.text);
  if (!cmd) return { action: "skipped", reason: "no command" };
  if (!(await ctx.store.takeCooldown(m.authorId)))
    return { action: "skipped", reason: "user cooldown" };
  if (cmd.kind === "propose") await saveProposal(ctx, m, cmd);

  const dry = ctx.cfg.dryRun;
  if ((await ctx.store.repliesToday(dry)) >= ctx.cfg.dailyReplyCap) {
    return { action: "skipped", reason: "daily reply cap" };
  }
  const text = await replyText(ctx, cmd);
  await ctx.store.countReply(dry);
  if (dry) {
    log.info("DRY RUN — would reply", { to: m.username, inReplyTo: m.id, command: cmd.kind, text });
    return { action: "would-reply", text };
  }
  const replyId = await ctx.source.reply(text, m.id);
  log.info("replied", { to: m.username, inReplyTo: m.id, command: cmd.kind, replyId });
  return { action: "replied", text, replyId };
}
