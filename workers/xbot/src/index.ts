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
import {
  FixtureSource,
  RateLimited,
  XApi,
  makeAuthorizer,
  whoAmI,
  type MentionSource,
} from "./xapi";
import { logUsage } from "./usage";
import { advanceBets } from "./bet-actions";
import { makeBetClient } from "./chain";

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
      if (out.action === "skipped") {
        // Show why a mention got no reply; only duplicates stay at debug.
        // "no command" includes the (public) text so the wording can be checked.
        const quiet = out.reason === "already handled";
        (quiet ? log.debug : log.info)("skipped", {
          id: m.id,
          from: m.username,
          reason: out.reason,
          ...(out.reason === "no command" ? { text: m.text.slice(0, 80) } : {}),
        });
      }
    } catch (e) {
      if (e instanceof RateLimited) throw e;
      log.error("mention failed", { id: m.id, error: errMsg(e) });
    }
    if (!ctx.cfg.fixture) await ctx.store.setCursor(maxId(await ctx.store.getCursor(), m.id)!);
  }
  if (newestId && !ctx.cfg.fixture) await ctx.store.setCursor(maxId(since, newestId)!);
  if (mentions.length) log.info("tick", { mentions: mentions.length });
}

/** Real X client (resolving the bot's user id if unset), a fixture, or null. */
async function makeSource(
  cfg: BotCtx["cfg"],
  store: Store,
): Promise<{ source: MentionSource; botUserId: string | null } | null> {
  if (cfg.fixture) return { source: new FixtureSource(cfg.fixture), botUserId: null };
  if (!cfg.x) return null;
  const authorize = makeAuthorizer(cfg.x.auth, store);
  let botUserId = cfg.x.botUserId;
  if (!botUserId) {
    const me = await whoAmI(authorize);
    botUserId = me.id;
    log.info("authenticated as", { username: me.username, id: me.id, auth: cfg.x.auth.kind });
  }
  return { source: new XApi(authorize, botUserId, store), botUserId };
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const store = Store.connect(cfg.redisUrl);
  const made = await makeSource(cfg, store).catch((e) => {
    log.error("X auth check failed — check the X_* variables", { error: errMsg(e) });
    return null;
  });
  log.info("xbot starting", {
    dryRun: cfg.dryRun,
    fixture: cfg.fixture,
    pollSecs: cfg.pollMs / 1000,
    dailyCap: cfg.dailyReplyCap,
  });
  if (!made && !cfg.x) {
    log.warn(
      "X credentials not set (X_API_KEY/SECRET + X_ACCESS_TOKEN/SECRET, or OAuth 2.0); idling",
    );
  }
  const betClient = cfg.bets ? makeBetClient(cfg.bets) : null;
  if (cfg.bets) {
    log.info("bets enabled", {
      botWallet: cfg.bets.wallet.publicKey.toBase58(),
      resolver: cfg.bets.resolver.toBase58(),
      stakeHours: cfg.bets.stakeWindowSecs / 3600,
    });
  }
  const ctx: BotCtx | null = made ? { cfg, store, betClient, ...made } : null;
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
        // Launch / settle the bot's bets (cache-driven; no-op in dry run).
        await advanceBets(ctx).catch((e) => log.warn("advanceBets failed", { error: errMsg(e) }));
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
