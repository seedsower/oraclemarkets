/**
 * Devnet end-to-end for bets from X. Uses the bot's REAL handleBet/advanceBets
 * with short windows. Needs a local Redis fed by the keeper (advanceBets reads
 * the keeper's cache), funded test wallets, and:
 *
 *   REDIS_URL=… XBOT_WALLET=<b64 bot key> XBOT_BET_RESOLVER=<resolver pubkey>
 *   XBOT_BET_STAKE_HOURS=0.02 XBOT_DRY_RUN=false XBOT_X_SKIP=1
 *   E2E_RESOLVER=<resolver.json> E2E_STAKER1=<a.json> E2E_STAKER2=<b.json>
 *   npx tsx scripts/e2e-bets.ts
 *
 * A: bet? → open → two stakes (YES $3 / NO $2) → bot launches at 60%.
 * B: short bet (1 min stakes, 5 min market) → launch → resolve YES → bot
 *    settles → YES staker claims the pot, NO staker gets nothing.
 */
import { readFileSync } from "node:fs";
import { AnchorProvider } from "@anchor-lang/core";
import { Connection, Keypair, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PmAmmClient } from "@pm-amm/sdk";
import { advanceBets, handleBet, type BetCtx } from "../src/bet-actions";
import { makeBetClient } from "../src/chain";
import { parseCommand } from "../src/commands";
import { loadConfig } from "../src/config";
import { Store } from "../src/store";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const say = (s: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${s}`);
const kp = (p: string) =>
  Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, "utf8"))));

function clientFor(k: Keypair, ctx: BetCtx): PmAmmClient {
  const b = ctx.cfg.bets!;
  const sign = <T extends Transaction | VersionedTransaction>(tx: T): T => {
    if (tx instanceof VersionedTransaction) tx.sign([k]);
    else tx.partialSign(k);
    return tx;
  };
  const wallet = {
    publicKey: k.publicKey,
    payer: k,
    signTransaction: async <T extends Transaction | VersionedTransaction>(t: T) => sign(t),
    signAllTransactions: async <T extends Transaction | VersionedTransaction>(t: T[]) =>
      t.map(sign),
  };
  const provider = new AnchorProvider(new Connection(b.rpcUrl, "confirmed"), wallet, {
    commitment: "confirmed",
  });
  return PmAmmClient.fromProvider(provider, b.programId, b.collateralMint);
}

async function until<T>(
  label: string,
  f: () => Promise<T | null | false>,
  ms: number,
  every = 10_000,
): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await f().catch(() => null);
    if (v) return v as T;
    await sleep(every);
  }
  throw new Error(`timed out: ${label}`);
}

async function usdc(c: PmAmmClient, owner: PublicKey): Promise<number> {
  const ata = getAssociatedTokenAddressSync(c.collateralMint, owner);
  return Number((await c.connection.getTokenAccountBalance(ata)).value.amount) / 1e6;
}

async function main() {
  const cfg = loadConfig();
  const store = Store.connect(cfg.redisUrl);
  const ctx: BetCtx = { cfg, store, betClient: makeBetClient(cfg.bets!) };
  const bot = ctx.betClient!;
  const [r, s1, s2] = [
    process.env.E2E_RESOLVER!,
    process.env.E2E_STAKER1!,
    process.env.E2E_STAKER2!,
  ].map(kp);
  const [resolver, staker1, staker2] = [r, s1, s2].map((k) => clientFor(k!, ctx));

  // ---- R: refund path on a leftover unlaunchable bet (E2E_REFUND_VAULT=<pda>)
  if (process.env.E2E_REFUND_VAULT) {
    const pk = new PublicKey(process.env.E2E_REFUND_VAULT);
    const b1 = await usdc(staker1, s1!.publicKey);
    await staker1.send.refundBet(pk);
    say(
      `refund on unlaunchable bet: +$${((await usdc(staker1, s1!.publicKey)) - b1).toFixed(6)} (staked $3)`,
    );
  }

  // ---- A: the real `bet?` path
  const stamp = Date.now();
  const m = {
    id: `e2e-${stamp}`,
    text: "@oraclexbot bet? by Oct 20",
    authorId: `e2e-${stamp}`,
    username: "e2e",
    parent: {
      id: `take-${stamp}`,
      text: "@someone Oracle Markets e2e: SOL flips ETH this month",
      username: "takeguy",
    },
  };
  const reply = await handleBet(ctx, m, parseCommand(m.text) as never);
  say(`bot reply:\n${reply}`);
  const idA = Number(reply.match(/\/bet\/(\d+)/)![1]);
  const pkA = bot.betVaultPda(idA);

  // ---- B: a short bet for the full resolve → claim cycle
  const B = await bot.send.createBetVault({
    name: `e2e short ${stamp}`,
    commitDurationSecs: 60,
    // Launch needs > 5 min of market left at launch time; 15 min leaves a
    // 10-min launch window even when a public RPC throttles the keeper.
    marketDurationSecs: 900,
    minTotal: 2,
    lpBps: 5000,
    resolver: cfg.bets!.resolver,
  });
  const pkB = new PublicKey(B.betVaultPda);
  say(`opened A=${idA} and B=${B.vaultId}`);

  for (const pk of [pkA, pkB]) {
    await staker1.send.betCommit(pk, "yes", 3);
    await staker2.send.betCommit(pk, "no", 2);
  }
  say("staked YES $3 / NO $2 on both");

  // advanceBets reads the keeper's cache: let it see the stakes, then launch.
  for (const [name, pk] of [
    ["A", pkA],
    ["B", pkB],
  ] as const) {
    const v = await until(
      `launch ${name}`,
      async () => {
        await advanceBets(ctx);
        const a = await bot.fetchBetVault(pk);
        return a?.launched ? a : null;
      },
      6 * 60_000,
    );
    say(`${name} launched by the bot at YES ${(v.priceBps / 100).toFixed(1)}% (expected 60%)`);
  }

  const before1 = await usdc(staker1, s1!.publicKey);
  const vB = (await bot.fetchBetVault(pkB))!;
  const wait = Number(vB.marketEndTs.toString()) * 1000 - Date.now() + 15_000;
  say(`waiting ${Math.ceil(wait / 1000)}s for B's market to end`);
  await sleep(Math.max(0, wait));
  await resolver.send.resolveBetVault(pkB, "yes");
  say("resolver resolved B: YES");

  await until(
    "settle B",
    async () => {
      await advanceBets(ctx);
      return (await bot.fetchBetVault(pkB))?.settled ?? false;
    },
    4 * 60_000,
  );
  say(
    `bot settled B; payout pool $${Number((await bot.fetchBetVault(pkB))!.payoutPool.toString()) / 1e6}`,
  );

  await staker1.send.claimBet(pkB);
  const after1 = await usdc(staker1, s1!.publicKey);
  say(`YES staker claimed: +$${(after1 - before1).toFixed(6)} (staked $3)`);
  const lost = await staker2.send
    .claimBet(pkB)
    .then(() => "claimed (0 payout)")
    .catch((e) => `rejected: ${String(e).slice(0, 80)}`);
  say(`NO staker claim: ${lost}`);
  await store.redis.quit();
}

main().catch((e) => {
  console.error("E2E FAILED:", e);
  process.exit(1);
});
