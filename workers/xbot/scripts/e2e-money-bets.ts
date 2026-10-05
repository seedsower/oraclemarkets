/**
 * Devnet end-to-end for stakes + automatic payouts from X wallets (~9 min).
 * The bot wallet opens a short bet it also resolves (test only), two fake X
 * users stake through the REAL handleMoney, the bot launches → resolves YES →
 * settles, then the REAL payoutPass pays the YES staker. Leftover test USDC is
 * withdrawn back to the bot. Local Redis with a copy of the keeper cache:
 *
 *   REDIS_URL=redis://localhost:6390 XBOT_WALLET=<b64 bot key> XBOT_BET_RESOLVER=<any>
 *   npx tsx scripts/e2e-money-bets.ts
 */
import { randomBytes } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { betVaultView } from "@pm-amm/sdk";
import { makeBetClient } from "../src/chain";
import { loadConfig } from "../src/config";
import { Custody } from "../src/custody";
import { handleMoney, type MoneyCtx } from "../src/money";
import { parseMoney } from "../src/money-commands";
import { payoutPass } from "../src/payouts";
import { Store } from "../src/store";
import { Wallets } from "../src/wallets";
import type { Mention } from "../src/xapi";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const say = (s: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${s}`);

async function setup() {
  if (!process.env.XBOT_WALLET_MASTER_KEY) {
    process.env.XBOT_WALLET_MASTER_KEY = randomBytes(32).toString("base64");
  }
  const cfg = loadConfig();
  if (!cfg.bets || !cfg.custody) throw new Error("needs XBOT_WALLET + XBOT_BET_RESOLVER");
  const store = Store.connect(cfg.redisUrl);
  const client = makeBetClient(cfg.bets);
  const custody = new Custody(client, cfg.bets.wallet, cfg.custody);
  const ctx: MoneyCtx = {
    siteUrl: cfg.siteUrl,
    store,
    wallets: new Wallets(store.redis, cfg.custody.master),
    custody,
  };
  return { cfg, store, client, ctx, bot: cfg.bets.wallet };
}

/** Put the vault's current on-chain state into the local keeper cache. */
async function cacheVault(env: Awaited<ReturnType<typeof setup>>, pda: string) {
  const acct = await env.client.fetchBetVault(new PublicKey(pda));
  const row = betVaultView(pda, acct!);
  const rows = (await env.store.betVaults()).filter((r) => r.publicKey !== pda);
  await env.store.redis.set(
    "cache:bet_vaults",
    JSON.stringify({ updatedAt: Date.now(), items: [...rows, row] }),
  );
  return row;
}

async function main() {
  const env = await setup();
  const { ctx, client, bot, cfg } = env;
  const opened = await client.send.createBetVault({
    name: "E2E: X wallet stakes",
    commitDurationSecs: 60,
    marketDurationSecs: 420,
    minTotal: 1,
    lpBps: 5000,
    resolver: bot.publicKey, // test only: the bot resolves its own test bet
  });
  const pda = opened.betVaultPda;
  say(`opened bet #${opened.vaultId}`);
  await cacheVault(env, pda);
  const replies: string[] = [];
  const mention = (user: string, text: string): Mention => ({
    id: `${Date.now()}${user}`,
    text,
    authorId: user,
    username: user,
    parent: null,
    urls: [`${cfg.siteUrl}/bet/${opened.vaultId}`],
  });
  const users = [`e2e-yes-${Date.now()}`, `e2e-no-${Date.now()}`];
  for (const [u, cmd] of [
    [users[0]!, "stake YES $2"],
    [users[1]!, "stake NO $1"],
  ] as const) {
    say(`> ${cmd}\n${await handleMoney(ctx, mention(u, cmd), parseMoney(cmd)!)}`);
  }
  await sleep(65_000);
  const launched = await client.send.launchBetVault(new PublicKey(pda));
  say(`launched market #${launched.marketId}`);
  await sleep(430_000);
  await client.send.resolveBetVault(new PublicKey(pda), "yes");
  await client.send.settleBetVault(new PublicKey(pda));
  say("resolved YES + settled");
  await cacheVault(env, pda);
  await payoutPass(ctx, {
    fetchMentions: async () => ({ mentions: [], newestId: null }),
    reply: async (text) => (replies.push(text), "r"),
  });
  say(`payout replies:\n${replies.join("\n---\n") || "(none)"}`);
  for (const u of users) {
    const back = `withdraw all to ${bot.publicKey.toBase58()}`;
    say(`> ${back}\n${await handleMoney(ctx, mention(u, back), parseMoney(back)!)}`);
  }
  await env.store.redis.quit();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
