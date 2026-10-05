import { PublicKey, type Keypair } from "@solana/web3.js";
import { Custody, TradeRefused, fromRaw } from "./custody";
import { log, errMsg } from "./log";
import type { MoneyCommand, Side } from "./money-commands";
import type { MarketRow } from "./replies";
import type { BetVaultRow, Store } from "./store";
import type { Wallets } from "./wallets";
import type { Mention } from "./xapi";

/**
 * Trading from X: `buy YES $5`, `sell YES`, `stake YES $10`, `balance`,
 * `withdraw … to <address>` from a custodial wallet per X account (devnet).
 * The market comes from the thread (a market/bet link in the mention or the
 * post it replies to, the bet opened on that take) or an inline "#<id>".
 */
export interface MoneyCtx {
  siteUrl: string;
  store: Store;
  wallets: Wallets;
  custody: Custody;
}

type Trade = Extract<MoneyCommand, { kind: "trade" }>;
export type Target =
  | { kind: "market"; market: MarketRow }
  | { kind: "bet"; bet: BetVaultRow }
  | { kind: "group"; groupId: number }
  | { kind: "none" };

const ID_RE = /\/(market|bet|group)\/(\d{1,16})\b/;

/** Market / bet / group ids from links like oraclemarkets.app/market/123. */
export function linkIds(urls: string[]): { type: "market" | "bet" | "group"; id: number }[] {
  return urls.flatMap((u) => {
    const m = u.match(ID_RE);
    return m ? [{ type: m[1] as "market" | "bet" | "group", id: Number(m[2]) }] : [];
  });
}

/** The market this command is about: inline #id, links in the mention, then its parent, then a bet on the parent take. */
export async function resolveTarget(store: Store, m: Mention, ref: string | null): Promise<Target> {
  const [{ markets }, bets] = await Promise.all([store.snapshot(), store.betVaults()]);
  const market = (id: number) => markets.find((x) => x.marketId === id);
  const bet = (id: number) => bets.find((x) => x.vaultId === id);
  if (ref) {
    const id = Number(ref);
    const mk = market(id);
    if (mk) return { kind: "market", market: mk };
    const b = bet(id);
    if (b) return { kind: "bet", bet: b };
  }
  for (const l of linkIds([...(m.urls ?? []), ...(m.parent?.urls ?? [])])) {
    if (l.type === "group") return { kind: "group", groupId: l.id };
    const hit = l.type === "market" ? market(l.id) : bet(l.id);
    if (hit)
      return l.type === "market"
        ? { kind: "market", market: hit as MarketRow }
        : { kind: "bet", bet: hit as BetVaultRow };
  }
  const onTake = m.parent ? await store.betForPost(m.parent.id) : null;
  const b = onTake ? bet(Number(onTake)) : undefined;
  return b ? { kind: "bet", bet: b } : { kind: "none" };
}

const money = (usd: number) => `$${usd.toFixed(2).replace(/\.00$/, "")}`;
const cents = (p: number) => `${Math.round(p * 100)}¢`;
export const txUrl = (sig: string) => `https://solscan.io/tx/${sig}?cluster=devnet`;

/** Run one money command for the mention's author (one at a time per user). */
export async function handleMoney(ctx: MoneyCtx, m: Mention, cmd: MoneyCommand): Promise<string> {
  if (cmd.kind === "money-help") return cmd.text;
  if (!(await ctx.store.lock(m.authorId)))
    return "Still working on your last one. Give it a minute.";
  try {
    const { kp, intro } = await walletFor(ctx, m);
    const body =
      cmd.kind === "balance"
        ? await balanceReply(ctx, m.authorId, kp)
        : cmd.kind === "withdraw"
          ? await withdraw(ctx, m.authorId, kp, cmd.to, cmd.usd)
          : await trade(ctx, m, kp, cmd);
    return `${intro}${body}`;
  } catch (e) {
    if (e instanceof TradeRefused) return e.message;
    log.error("money command failed", { by: m.username, kind: cmd.kind, error: errMsg(e) });
    return "That didn't go through, and nothing was charged. Try again in a minute, or a smaller amount.";
  } finally {
    await ctx.store.unlock(m.authorId);
  }
}

/** The user's wallet; a new one gets the starter balance. */
async function walletFor(ctx: MoneyCtx, m: Mention): Promise<{ kp: Keypair; intro: string }> {
  const { kp, created } = await ctx.wallets.getOrCreate(m.authorId, m.username);
  if (!created) return { kp, intro: "" };
  await ctx.custody.fund(kp.publicKey);
  log.info("new X wallet", { by: m.username, wallet: kp.publicKey.toBase58() });
  return {
    kp,
    intro: `New here: your wallet has ${money(ctx.custody.cfg.starterUsdc)} test USDC. `,
  };
}

/** Per-trade and per-day limits, and enough cash. */
async function checkSpend(ctx: MoneyCtx, userId: string, kp: Keypair, usd: number): Promise<void> {
  const c = ctx.custody.cfg;
  if (usd > c.maxTradeUsdc)
    throw new TradeRefused(`Max ${money(c.maxTradeUsdc)} per trade on devnet.`);
  const spent = await ctx.store.usdToday("spend", userId);
  if (spent + usd > c.dailyUsdc) {
    throw new TradeRefused(
      `Daily limit is ${money(c.dailyUsdc)}; you have ${money(Math.max(0, c.dailyUsdc - spent))} left today.`,
    );
  }
  const cash = await ctx.custody.usdc(kp.publicKey);
  if (cash < usd) throw new TradeRefused(`Your balance is ${money(cash)}.`);
}

async function trade(ctx: MoneyCtx, m: Mention, kp: Keypair, cmd: Trade): Promise<string> {
  const t = await resolveTarget(ctx.store, m, cmd.ref);
  const now = Math.floor(Date.now() / 1000);
  if (t.kind === "none")
    return 'Which market? Reply under a market post, or add its id: "buy YES $5 #123456".';
  if (t.kind === "group")
    return `Multi-outcome markets trade on the site: ${ctx.siteUrl}/group/${t.groupId}`;
  if (t.kind === "bet") return betTrade(ctx, m, kp, cmd, t.bet, now);
  if (t.market.resolved || t.market.endTs <= now) return "That market is closed for trading.";
  return marketTrade(ctx, m, kp, cmd, t.market);
}

async function betTrade(
  ctx: MoneyCtx,
  m: Mention,
  kp: Keypair,
  cmd: Trade,
  b: BetVaultRow,
  now: number,
) {
  if (!b.launched && now < b.commitEndTs && cmd.action !== "sell") {
    await checkSpend(ctx, m.authorId, kp, cmd.usd!);
    const sig = await ctx.custody.stake(kp, new PublicKey(b.publicKey), cmd.side, cmd.usd!);
    await ctx.store.addUsd("spend", m.authorId, cmd.usd!);
    await ctx.store.trackOpen(m.authorId, `b:${b.publicKey}`, m.id);
    const cash = await ctx.custody.usdc(kp.publicKey);
    return `Staked ${money(cmd.usd!)} on ${cmd.side.toUpperCase()}. Balance ${money(cash)}.\n${txUrl(sig)}`;
  }
  const { markets } = await ctx.store.snapshot();
  const live = b.launched ? markets.find((x) => x.publicKey === b.market) : undefined;
  if (live && !live.resolved && live.endTs > now) return marketTrade(ctx, m, kp, cmd, live);
  return cmd.action === "sell"
    ? "Stakes can't be sold; they pay out when the bet settles."
    : "Staking on that bet is closed.";
}

async function marketTrade(
  ctx: MoneyCtx,
  m: Mention,
  kp: Keypair,
  cmd: Trade,
  mk: MarketRow,
): Promise<string> {
  const market = new PublicKey(mk.publicKey);
  const link = `${ctx.siteUrl}/market/${mk.marketId}`;
  const side = cmd.side.toUpperCase();
  if (cmd.action === "sell") return sell(ctx, m, kp, cmd, mk);
  await checkSpend(ctx, m.authorId, kp, cmd.usd!);
  const r = await ctx.custody.swap(kp, market, cmd.side, "buy", cmd.usd!);
  await ctx.store.addUsd("spend", m.authorId, cmd.usd!);
  await ctx.store.trackOpen(m.authorId, `m:${mk.publicKey}`, m.id);
  const cash = await ctx.custody.usdc(kp.publicKey);
  return `Bought ${r.out.toFixed(2)} ${side} at ${cents(r.avg)} (${money(r.amountIn)}). Balance ${money(cash)}.\n${link}\n${txUrl(r.sig)}`;
}

async function sell(
  ctx: MoneyCtx,
  m: Mention,
  kp: Keypair,
  cmd: Trade,
  mk: MarketRow,
): Promise<string> {
  const market = new PublicKey(mk.publicKey);
  const mint =
    cmd.side === "yes" ? ctx.custody.client.yesMint(market) : ctx.custody.client.noMint(market);
  const held = fromRaw(await ctx.custody.tokenBalance(kp.publicKey, mint));
  const side = cmd.side.toUpperCase();
  if (held <= 0) return `You don't hold ${side} on this market.`;
  const price = cmd.side === "yes" ? mk.price : 1 - mk.price;
  const tokens = cmd.usd === null ? held : Math.min(held, cmd.usd / Math.max(price, 0.01));
  const r = await ctx.custody.swap(kp, market, cmd.side as Side, "sell", tokens);
  const cash = await ctx.custody.usdc(kp.publicKey);
  return `Sold ${r.amountIn.toFixed(2)} ${side} for ${money(r.out)} (${cents(r.avg)} each). Balance ${money(cash)}.\n${txUrl(r.sig)}`;
}

async function withdraw(
  ctx: MoneyCtx,
  userId: string,
  kp: Keypair,
  to: string,
  usd: number | null,
) {
  let dest: PublicKey;
  try {
    dest = new PublicKey(to);
  } catch {
    return "That isn't a valid Solana address.";
  }
  const cash = await ctx.custody.usdc(kp.publicKey);
  const amount = usd ?? cash;
  if (amount <= 0 || amount > cash) return `Your balance is ${money(cash)}.`;
  const sent = await ctx.store.usdToday("withdrawn", userId);
  if (sent + amount > ctx.custody.cfg.dailyUsdc) {
    return `Withdrawals are capped at ${money(ctx.custody.cfg.dailyUsdc)} a day on devnet.`;
  }
  const sig = await ctx.custody.withdraw(kp, dest, amount);
  await ctx.store.addUsd("withdrawn", userId, amount);
  return `Sent ${money(amount)} to ${to.slice(0, 4)}…${to.slice(-4)}.\n${txUrl(sig)}`;
}

/** Cash plus open positions (top 3 by value). */
async function balanceReply(ctx: MoneyCtx, userId: string, kp: Keypair): Promise<string> {
  const cash = await ctx.custody.usdc(kp.publicKey);
  const { markets } = await ctx.store.snapshot();
  const lines: { text: string; value: number }[] = [];
  for (const { member } of await ctx.store.openFor(userId)) {
    const mk = member.startsWith("m:")
      ? markets.find((x) => x.publicKey === member.slice(2))
      : null;
    if (!mk) continue;
    const pk = new PublicKey(mk.publicKey);
    const yes = fromRaw(
      await ctx.custody.tokenBalance(kp.publicKey, ctx.custody.client.yesMint(pk)),
    );
    const no = fromRaw(await ctx.custody.tokenBalance(kp.publicKey, ctx.custody.client.noMint(pk)));
    if (yes > 0)
      lines.push({
        text: `${yes.toFixed(1)} YES · ${mk.name.slice(0, 40)}`,
        value: yes * mk.price,
      });
    if (no > 0)
      lines.push({
        text: `${no.toFixed(1)} NO · ${mk.name.slice(0, 40)}`,
        value: no * (1 - mk.price),
      });
  }
  const top = lines
    .sort((a, b) => b.value - a.value)
    .slice(0, 3)
    .map((l) => `• ${l.text}`);
  const wallet = kp.publicKey.toBase58();
  return [
    `Balance ${money(cash)} USDC (wallet ${wallet.slice(0, 4)}…${wallet.slice(-4)}).`,
    ...top,
  ].join("\n");
}

/**
 * "bet? … I'll take YES $10": stake for the person who called the bet, right
 * after the bot opens it (the keeper cache doesn't have the new vault yet,
 * so this skips resolveTarget). Returns a short line for the bet reply.
 */
export async function stakeOnOpen(
  ctx: MoneyCtx,
  m: Mention,
  betVault: string,
  side: Side,
  usd: number,
): Promise<string> {
  if (!(await ctx.store.lock(m.authorId))) return "";
  try {
    const { kp } = await walletFor(ctx, m);
    await checkSpend(ctx, m.authorId, kp, usd);
    await ctx.custody.stake(kp, new PublicKey(betVault), side, usd);
    await ctx.store.addUsd("spend", m.authorId, usd);
    await ctx.store.trackOpen(m.authorId, `b:${betVault}`, m.id);
    return `\nYou're in: ${side.toUpperCase()} ${money(usd)}.`;
  } catch (e) {
    if (e instanceof TradeRefused) return `\nCouldn't stake for you: ${e.message}`;
    log.error("stake on open failed", { by: m.username, error: errMsg(e) });
    return "";
  } finally {
    await ctx.store.unlock(m.authorId);
  }
}
