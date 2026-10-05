/**
 * Devnet end-to-end for trading from X with a custodial wallet. Runs the bot's
 * REAL handleMoney on fake mentions against a local Redis that holds a copy
 * of the keeper cache, with a throwaway master key and X user id:
 *
 *   REDIS_URL=redis://localhost:6390 XBOT_WALLET=<b64 bot key> XBOT_BET_RESOLVER=<pubkey>
 *   npx tsx scripts/e2e-money.ts
 *
 * new wallet + $50 → buy YES $2 on a live market → balance → sell all YES
 * → stake YES $1 on an open bet (if any) → withdraw $1 back to the bot wallet.
 */
import { randomBytes } from "node:crypto";
import { makeBetClient } from "../src/chain";
import { loadConfig } from "../src/config";
import { Custody } from "../src/custody";
import { handleMoney, type MoneyCtx } from "../src/money";
import { parseMoney } from "../src/money-commands";
import { Store } from "../src/store";
import { Wallets } from "../src/wallets";
import type { Mention } from "../src/xapi";

const say = (s: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${s}`);

async function main() {
  process.env.XBOT_WALLET_MASTER_KEY ??= randomBytes(32).toString("base64");
  const cfg = loadConfig();
  if (!cfg.bets || !cfg.custody) throw new Error("needs XBOT_WALLET + XBOT_BET_RESOLVER");
  const store = Store.connect(cfg.redisUrl);
  const custody = new Custody(makeBetClient(cfg.bets), cfg.bets.wallet, cfg.custody);
  const ctx: MoneyCtx = {
    siteUrl: cfg.siteUrl,
    store,
    wallets: new Wallets(store.redis, cfg.custody.master),
    custody,
  };
  const now = Math.floor(Date.now() / 1000);
  const { markets } = await store.snapshot();
  const live = markets
    .filter((m) => !m.resolved && m.endTs > now + 3600 && (!m.group || m.group.startsWith("1111")))
    .sort((a, b) => b.lZero - a.lZero)[0];
  if (!live) throw new Error("no live market in the cache");
  const userId = `e2e-${Date.now()}`;
  const marketUrl = `${cfg.siteUrl}/market/${live.marketId}`;
  const run = async (text: string, urls: string[] = [marketUrl]) => {
    const m: Mention = {
      id: `${Date.now()}`,
      text,
      authorId: userId,
      username: "e2e",
      parent: null,
      urls,
    };
    const out = await handleMoney(ctx, m, parseMoney(text)!);
    say(`> ${text}\n${out}\n`);
    return out;
  };
  say(`market #${live.marketId}: ${live.name}`);
  await run("buy YES $2");
  await run("balance");
  await run("sell YES");
  const bet = (await store.betVaults()).find((v) => !v.launched && v.commitEndTs > now + 120);
  if (bet) await run("stake YES $1", [`${cfg.siteUrl}/bet/${bet.vaultId}`]);
  else say("(no bet open for staking right now; skipped stake)");
  await run(`withdraw $1 to ${cfg.bets.wallet.publicKey.toBase58()}`);
  await store.redis.quit();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
