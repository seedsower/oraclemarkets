import { PublicKey, type AccountInfo } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { betPayout, type BetPositionAccount } from "@pm-amm/sdk";
import { log } from "./log";
import type { MoneyCtx } from "./money";
import type { BetVaultRow } from "./store";

/**
 * Leaderboard of X-wallet traders, rebuilt every 10 minutes into Redis
 * `leaderboard` (the web's /leaderboard reads it — no RPC from the site).
 *
 *   value = cash + shares at today's price + open stakes (settled ones at payout)
 *   P&L   = value + withdrawn − funded (the starter balance)
 *
 * Money sent INTO a wallet from outside isn't tracked, so it counts as profit.
 */
export const LEADERBOARD_KEY = "leaderboard";
const EVERY_MS = 10 * 60_000;
const DEFAULT_FUNDED = 50; // wallets made before stats existed got the $50 starter

export interface LeaderRow {
  handle: string;
  wallet: string;
  cash: number;
  shares: number;
  stakes: number;
  value: number;
  pnl: number;
  volume: number;
  trades: number;
}

type Row = Record<string, unknown>;
const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0) || 0);

/** A stake's worth now: face value until settled, then the payout (0 if it lost). */
export function stakeValue(v: Row, yes: number, no: number): number {
  if (v.voided) return betPayout(num(v.payoutPool), yes + no, num(v.yesTotal) + num(v.noTotal));
  if (!v.settled) return yes + no;
  const yesWon = num(v.winningSide) === 1;
  const stake = yesWon ? yes : no;
  return stake > 0
    ? betPayout(num(v.payoutPool), stake, yesWon ? num(v.yesTotal) : num(v.noTotal))
    : 0;
}

export function rankRows(rows: LeaderRow[]): LeaderRow[] {
  return [...rows].sort((a, b) => b.pnl - a.pnl || b.volume - a.volume);
}

/** Shares (YES/NO tokens of known markets) valued at today's price, in USDC. */
async function sharesValue(ctx: MoneyCtx, owner: PublicKey, markets: Row[]): Promise<number> {
  const conn = ctx.custody.client.connection;
  const res = await conn.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID });
  const held = new Map<string, number>();
  for (const a of res.value) {
    const info = a.account.data.parsed.info as { mint: string; tokenAmount: { uiAmount: number } };
    if (info.tokenAmount.uiAmount > 0) held.set(info.mint, info.tokenAmount.uiAmount);
  }
  let total = 0;
  for (const m of markets) {
    if (m.resolved) continue; // winning shares get redeemed into cash by the payout pass
    const pk = new PublicKey(String(m.publicKey));
    const price = num(m.price);
    total += (held.get(ctx.custody.client.yesMint(pk).toBase58()) ?? 0) * price;
    total += (held.get(ctx.custody.client.noMint(pk).toBase58()) ?? 0) * (1 - price);
  }
  return total;
}

/** Open stakes across every bet, in USDC (one batched read per 100 bets). */
async function stakesValue(ctx: MoneyCtx, owner: PublicKey, bets: BetVaultRow[]): Promise<number> {
  const client = ctx.custody.client;
  const pdas = bets.map((v) => client.betPosition(new PublicKey(v.publicKey), owner));
  const infos: (AccountInfo<Buffer> | null)[] = [];
  for (let i = 0; i < pdas.length; i += 100) {
    infos.push(...(await client.connection.getMultipleAccountsInfo(pdas.slice(i, i + 100))));
  }
  let raw = 0;
  infos.forEach((info, i) => {
    if (!info) return;
    const p = client.program.coder.accounts.decode<BetPositionAccount>("betPosition", info.data);
    raw += stakeValue(bets[i]!, Number(p.yesAmount.toString()), Number(p.noAmount.toString()));
  });
  return raw / 1e6;
}

async function rowFor(
  ctx: MoneyCtx,
  userId: string,
  rec: { pubkey: string; handle: string },
  lists: { markets: Row[]; bets: BetVaultRow[] },
): Promise<LeaderRow> {
  const owner = new PublicKey(rec.pubkey);
  const [cash, shares, stakes, stats] = await Promise.all([
    ctx.custody.usdc(owner),
    sharesValue(ctx, owner, lists.markets),
    stakesValue(ctx, owner, lists.bets),
    ctx.store.redis.hgetall(`xwallet:stats:${userId}`),
  ]);
  const value = cash + shares + stakes;
  const funded = stats.funded ? num(stats.funded) : DEFAULT_FUNDED;
  const pnl = value + num(stats.withdrawn) - funded;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return {
    handle: rec.handle,
    wallet: rec.pubkey,
    cash: r2(cash),
    shares: r2(shares),
    stakes: r2(stakes),
    value: r2(value),
    pnl: r2(pnl),
    volume: r2(num(stats.volume)),
    trades: num(stats.trades),
  };
}

/** Rebuild the leaderboard if it's older than 10 minutes. */
export async function leaderboardPass(ctx: MoneyCtx): Promise<void> {
  const prev = await ctx.store.redis.get(LEADERBOARD_KEY);
  if (prev && Date.now() - (JSON.parse(prev) as { updatedAt: number }).updatedAt < EVERY_MS) return;
  const [wallets, lists] = await Promise.all([
    ctx.store.redis.hgetall("xwallets"),
    ctx.store.lists(),
  ]);
  const rows: LeaderRow[] = [];
  for (const [userId, raw] of Object.entries(wallets)) {
    const rec = JSON.parse(raw) as { pubkey: string; handle: string };
    if (!rec.handle) continue;
    try {
      rows.push(
        await rowFor(ctx, userId, rec, {
          markets: lists.markets,
          bets: lists.betVaults as BetVaultRow[],
        }),
      );
    } catch (e) {
      log.warn("leaderboard row failed", { handle: rec.handle, error: String(e).slice(0, 120) });
    }
  }
  const body = { updatedAt: Date.now(), rows: rankRows(rows) };
  await ctx.store.redis.set(LEADERBOARD_KEY, JSON.stringify(body));
  log.info("leaderboard updated", { traders: rows.length });
}
