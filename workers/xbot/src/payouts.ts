import { PublicKey } from "@solana/web3.js";
import { betPhase, type BetVaultView } from "@pm-amm/sdk";
import { fromRaw } from "./custody";
import { log, errMsg } from "./log";
import { txUrl, type MoneyCtx } from "./money";
import type { MentionSource } from "./xapi";

/**
 * Pays out X wallets automatically: winning tokens of resolved markets are
 * redeemed, settled/voided bets claimed and failed bets refunded, then the
 * bot replies to the post that opened the position. A few actions per poll.
 */
const MAX_ACTIONS = 3;
const money = (usd: number) => `$${usd.toFixed(2).replace(/\.00$/, "")}`;

type Outcome = { text: string } | "done" | "wait";

async function payMarket(ctx: MoneyCtx, userId: string, marketPk: string): Promise<Outcome> {
  const { markets } = await ctx.store.snapshot();
  const mk = markets.find((x) => x.publicKey === marketPk);
  if (!mk) return "wait";
  if (!mk.resolved) return "wait";
  const kp = await ctx.wallets.get(userId);
  if (!kp) return "done";
  const market = new PublicKey(marketPk);
  const yesWon = mk.winningSide === 1;
  const mint = yesWon ? ctx.custody.client.yesMint(market) : ctx.custody.client.noMint(market);
  const won = fromRaw(await ctx.custody.tokenBalance(kp.publicKey, mint));
  if (won <= 0) return "done"; // lost (or already claimed on the site)
  const sig = await ctx.custody.claimMarket(kp, market);
  const side = yesWon ? "YES" : "NO";
  return {
    text: `${side} won on "${mk.name.slice(0, 60)}": ${money(won)} paid to your wallet.\n${txUrl(sig)}`,
  };
}

async function payBet(ctx: MoneyCtx, userId: string, vaultPk: string): Promise<Outcome> {
  const [rows, { markets }] = await Promise.all([ctx.store.betVaults(), ctx.store.snapshot()]);
  const v = rows.find((x) => x.publicKey === vaultPk) as unknown as BetVaultView | undefined;
  if (!v) return "wait";
  const resolved = markets.some((x) => x.publicKey === v.market && x.resolved);
  const phase = betPhase(v, Math.floor(Date.now() / 1000), resolved);
  const how =
    phase === "claimable" || phase === "voided"
      ? "claim"
      : phase === "refundable"
        ? "refund"
        : null;
  if (!how) return "wait";
  const kp = await ctx.wallets.get(userId);
  const pos = kp
    ? await ctx.custody.client.fetchBetPosition(new PublicKey(vaultPk), kp.publicKey)
    : null;
  if (!kp || !pos) return "done"; // nothing staked, or already collected
  const before = await ctx.custody.usdc(kp.publicKey);
  const sig = await ctx.custody.collectBet(kp, new PublicKey(vaultPk), how);
  const got = (await ctx.custody.usdc(kp.publicKey)) - before;
  const what =
    how === "refund"
      ? "refunded"
      : phase === "voided"
        ? "voided, refunded"
        : got > 0
          ? "won"
          : "settled";
  if (got <= 0 && how === "claim") return "done";
  return {
    text: `Bet "${v.name.slice(0, 60)}" ${what}: ${money(got)} paid to your wallet.\n${txUrl(sig)}`,
  };
}

export async function payoutPass(ctx: MoneyCtx, source: MentionSource): Promise<void> {
  let actions = 0;
  for (const userId of await ctx.store.openUsers()) {
    for (const { member, postId } of await ctx.store.openFor(userId)) {
      if (actions >= MAX_ACTIONS) return;
      if (!(await ctx.store.lock(userId))) break;
      try {
        const pk = member.slice(2);
        const out = member.startsWith("m:")
          ? await payMarket(ctx, userId, pk)
          : await payBet(ctx, userId, pk);
        if (out === "wait") continue;
        actions++;
        await ctx.store.untrackOpen(userId, member);
        if (out !== "done" && postId) await source.reply(out.text, postId);
        if (out !== "done") log.info("paid out", { userId, member });
      } catch (e) {
        log.warn("payout failed (retrying next pass)", { userId, member, error: errMsg(e) });
      } finally {
        await ctx.store.unlock(userId);
      }
    }
  }
}
