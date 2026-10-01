/**
 * Oracle Markets mention bot (Railway `xbot` service).
 *
 * Polls the bot account's mentions every XBOT_POLL_SECS and answers three
 * deterministic commands (odds / markets / propose) with links — market links
 * unfurl as Blinks. It never trades, never holds funds, and only ever replies
 * to posts that mention it. XBOT_DRY_RUN defaults to true.
 */
import { handleMention, type BotCtx } from "./bot";
import { loadConfig } from "./config";
import { log, errMsg } from "./log";
import { Store } from "./store";
import { FixtureSource, RateLimited, XApi, type MentionSource } from "./xapi";
import { logUsage } from "./usage";

const maxId = (a: string | null, b: string | null) =>
  !a ? b : !b ? a : BigInt(a) >= BigInt(b) ? a : b;

/** First run: start from "now" instead of answering the whole backlog. */
async function bootstrap(ctx: BotCtx): Promise<void> {
  if (ctx.cfg.fixture || (await ctx.store.getCursor())) return;
  const { mentions, newestId } = await ctx.source.fetchMentions(null);
  if (newestId) await ctx.store.setCursor(newestId);
  log.info("bootstrapped cursor; older mentions ignored", { ignored: mentions.length, newestId });
}

async function tick(ctx: BotCtx): Promise<void> {
  const since = await ctx.store.getCursor();
  const { mentions, newestId } = await ctx.source.fetchMentions(since);
  // X returns newest first; answer in the order people posted.
  const ordered = [...mentions].sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
  for (const m of ordered) {
    try {
      const out = await handleMention(ctx, m);
      if (out.action === "skipped") log.debug("skipped", { id: m.id, reason: out.reason });
    } catch (e) {
      if (e instanceof RateLimited) throw e;
      log.error("mention failed", { id: m.id, error: errMsg(e) });
    }
    if (!ctx.cfg.fixture) await ctx.store.setCursor(maxId(await ctx.store.getCursor(), m.id)!);
  }
  if (newestId && !ctx.cfg.fixture) await ctx.store.setCursor(maxId(since, newestId)!);
  if (mentions.length) log.info("tick", { mentions: mentions.length });
}

function makeSource(cfg: BotCtx["cfg"], store: Store): MentionSource | null {
  if (cfg.fixture) return new FixtureSource(cfg.fixture);
  return cfg.x ? new XApi(cfg.x, store) : null;
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const store = Store.connect(cfg.redisUrl);
  const source = makeSource(cfg, store);
  log.info("xbot starting", {
    dryRun: cfg.dryRun,
    fixture: cfg.fixture,
    pollSecs: cfg.pollMs / 1000,
    dailyCap: cfg.dailyReplyCap,
  });
  if (!source) {
    log.warn("X credentials not set (X_CLIENT_ID / X_CLIENT_SECRET / X_BOT_USER_ID); idling");
  }
  const ctx = source ? { cfg, store, source } : null;
  let stopping = false;
  let wake: (() => void) | null = null;
  const stop = () => {
    stopping = true;
    wake?.();
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);

  if (ctx) await bootstrap(ctx).catch((e) => log.error("bootstrap failed", { error: errMsg(e) }));
  while (!stopping) {
    let waitMs = cfg.pollMs;
    if (ctx) {
      try {
        await tick(ctx);
        await logUsage(store, cfg);
      } catch (e) {
        if (e instanceof RateLimited) waitMs = Math.max(cfg.pollMs, e.resetAt - Date.now());
        log.warn("tick failed", { error: errMsg(e), nextInSecs: Math.round(waitMs / 1000) });
      }
    }
    if (cfg.fixture || stopping) break; // fixture runs once
    await new Promise<void>((r) => {
      const t = setTimeout(r, waitMs);
      wake = () => (clearTimeout(t), r());
    });
  }
  await store.redis.quit().catch(() => {});
  log.info("xbot stopped");
}

main().catch((e) => {
  log.error("xbot failed to start", { error: errMsg(e) });
  process.exit(1);
});
