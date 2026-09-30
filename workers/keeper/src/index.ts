/**
 * Oracle Markets keeper (Railway `keeper` service).
 *
 * Every KEEPER_INTERVAL_SECS:
 *   1. read all markets / groups / vaults / vault groups from the RPC (one
 *      `getProgramAccounts` each, for every visitor combined);
 *   2. cache the display-ready rows (SDK `*View`, same code as the browser) in
 *      Redis for `/api/{markets,groups,vaults,vault-groups}`;
 *   3. append chart points for active markets (the only price-history writer);
 *   4. optionally `accrue` LP'd markets from a dedicated hot wallet.
 */
import { Connection } from "@solana/web3.js";
import type IORedis from "ioredis";
import {
  ACCOUNT_SIZES,
  PmAmmClient,
  groupView,
  marketView,
  vaultGroupView,
  vaultView,
  type MarketView,
} from "@pm-amm/sdk";
import { accrueAll, makeAccrueClient } from "./accrue";
import { connectRedis, isChartable, recordPrice, writeList, LIST_KEYS } from "./cache";
import { loadConfig, type KeeperConfig } from "./config";
import { log, errMsg } from "./log";
import { isRateLimited, withBackoff } from "./rpc";

const MAX_IDLE_MS = 5 * 60_000;

interface Ctx {
  cfg: KeeperConfig;
  reader: PmAmmClient;
  accruer: PmAmmClient | null;
  redis: IORedis;
  lastAccrueAt: number;
}

/** Fetch + cache one list; a failure is logged and doesn't stop the others. */
async function syncList<T>(
  ctx: Ctx,
  key: keyof typeof LIST_KEYS,
  fetchRows: () => Promise<T[]>,
): Promise<T[] | null> {
  try {
    const rows = await withBackoff(key, fetchRows);
    await writeList(ctx.redis, key, rows, Date.now());
    return rows;
  } catch (e) {
    log.error("list sync failed", { list: key, error: errMsg(e), rateLimited: isRateLimited(e) });
    if (isRateLimited(e)) throw e; // let the loop back off as a whole
    return null;
  }
}

async function recordPrices(ctx: Ctx, markets: MarketView[], now: number): Promise<number> {
  let written = 0;
  for (const m of markets) {
    if (!isChartable(m, now)) continue;
    try {
      if (await recordPrice(ctx.redis, m, now)) written++;
    } catch (e) {
      log.warn("price point failed", { market: m.publicKey, error: errMsg(e) });
    }
  }
  return written;
}

async function tick(ctx: Ctx): Promise<void> {
  const started = Date.now();
  const now = Math.floor(started / 1000);
  const r = ctx.reader;

  const markets = await syncList(ctx, "markets", async () =>
    (await r.fetchAllMarkets(ACCOUNT_SIZES.market)).map((a) =>
      marketView(a.publicKey.toBase58(), a.account, now),
    ),
  );
  const byPubkey = new Map((markets ?? []).map((m) => [m.publicKey, m]));
  const groups = await syncList(ctx, "groups", async () =>
    (await r.fetchAllGroups(ACCOUNT_SIZES.groupMarket)).map((a) =>
      groupView(a.publicKey.toBase58(), a.account, byPubkey),
    ),
  );
  const vaults = await syncList(ctx, "vaults", async () =>
    (await r.fetchAllVaults(ACCOUNT_SIZES.commitmentVault)).map((a) =>
      vaultView(a.publicKey.toBase58(), a.account, now),
    ),
  );
  const vaultGroups = await syncList(ctx, "vaultGroups", async () =>
    (await r.fetchAllVaultGroups(ACCOUNT_SIZES.commitmentVaultGroup)).map((a) =>
      vaultGroupView(a.publicKey.toBase58(), a.account, now),
    ),
  );

  const points = markets ? await recordPrices(ctx, markets, now) : 0;
  await maybeAccrue(ctx, markets, now);

  log.info("tick", {
    ms: Date.now() - started,
    markets: markets?.length ?? null,
    groups: groups?.length ?? null,
    vaults: vaults?.length ?? null,
    vaultGroups: vaultGroups?.length ?? null,
    pricePoints: points,
  });
}

async function maybeAccrue(ctx: Ctx, markets: MarketView[] | null, now: number): Promise<void> {
  const acc = ctx.cfg.accrue;
  if (!acc || !ctx.accruer || !markets) return;
  if (Date.now() - ctx.lastAccrueAt < acc.everyMs) return;
  ctx.lastAccrueAt = Date.now();
  try {
    await accrueAll(ctx.accruer, acc, markets, now);
  } catch (e) {
    log.error("accrue pass failed", { error: errMsg(e) });
  }
}

function init(): Ctx {
  const cfg = loadConfig();
  // Our own backoff (rpc.ts) handles 429s; web3.js's built-in retry would hide them.
  const connection = new Connection(cfg.rpcUrl, {
    commitment: "confirmed",
    disableRetryOnRateLimit: true,
  });
  const ctx: Ctx = {
    cfg,
    reader: PmAmmClient.readOnly(connection, cfg.programId, cfg.collateralMint),
    accruer: makeAccrueClient(connection, cfg),
    redis: connectRedis(cfg.redisUrl),
    lastAccrueAt: 0,
  };
  log.info("keeper starting", {
    programId: cfg.programId.toBase58(),
    rpcHost: new URL(cfg.rpcUrl).host,
    intervalSecs: cfg.intervalMs / 1000,
    accrue: cfg.accrue
      ? { wallet: cfg.accrue.keypair.publicKey.toBase58(), everySecs: cfg.accrue.everyMs / 1000 }
      : "disabled",
  });
  return ctx;
}

async function main(): Promise<void> {
  const ctx = init();
  let stopping = false;
  let wake: (() => void) | null = null;
  const stop = (signal: string) => {
    log.info("shutdown requested; finishing current tick", { signal });
    stopping = true;
    wake?.();
  };
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));

  let idleMs = ctx.cfg.intervalMs;
  while (!stopping) {
    try {
      await tick(ctx);
      idleMs = ctx.cfg.intervalMs;
    } catch (e) {
      // Only whole-tick rate limiting lands here: stretch the interval.
      idleMs = Math.min(idleMs * 2, MAX_IDLE_MS);
      log.warn("tick failed; slowing down", { error: errMsg(e), nextInSecs: idleMs / 1000 });
    }
    if (stopping) break;
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, idleMs);
      wake = () => {
        clearTimeout(t);
        resolve();
      };
    });
    wake = null;
  }
  await ctx.redis.quit().catch(() => {});
  log.info("keeper stopped");
}

process.on("unhandledRejection", (e) => log.error("unhandled rejection", { error: errMsg(e) }));

main().catch((e) => {
  log.error("keeper failed to start", { error: errMsg(e) });
  process.exit(1);
});
