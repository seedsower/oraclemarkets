import { parseCommand, type Command } from "./commands";
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
import type { Mention, MentionSource } from "./xapi";

export interface BotCtx {
  cfg: XbotConfig;
  store: Store;
  source: MentionSource;
  /** The bot account's user id (never reply to ourselves); null in fixture runs. */
  botUserId: string | null;
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
async function plan(ctx: BotCtx, cmd: Command): Promise<Plan> {
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
  const p = await plan(ctx, cmd);
  if (p.propose) await saveProposal(ctx, m, p.propose);

  const dry = ctx.cfg.dryRun;
  if ((await ctx.store.repliesToday(dry)) >= ctx.cfg.dailyReplyCap) {
    return { action: "skipped", reason: "daily reply cap" };
  }
  const text = p.text;
  await ctx.store.countReply(dry);
  if (dry) {
    log.info("DRY RUN — would reply", { to: m.username, inReplyTo: m.id, command: cmd.kind, text });
    return { action: "would-reply", text };
  }
  const replyId = await ctx.source.reply(text, m.id);
  log.info("replied", { to: m.username, inReplyTo: m.id, command: cmd.kind, replyId });
  return { action: "replied", text, replyId };
}
