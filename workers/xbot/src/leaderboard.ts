import { PublicKey, type AccountInfo } from "@solana/web3.js";
import { betPayout, type BetPositionAccount } from "@pm-amm/sdk";
import { log } from "./log";
import type { MoneyCtx } from "./money";
import { recentTrades, type TradeRecord } from "./trades-index";

/**
 * Leaderboard: everyone who traded in the last 48 hours (site or X), rebuilt
 * every 10 minutes into Redis `leaderboard` (the web's /leaderboard reads it).
 *
 *   P&L (48h) = USDC in − USDC out over the window
 *             + shares picked up in the window × today's price (1/0 once resolved)
 *             + stakes placed in the window, at what they're worth now
 *
 * Claims are neutral (USDC in, winning shares out), so liquidity rewards
 * claimed later don't show up as trading profit.
 */
export const LEADERBOARD_KEY = "leaderboard";
const EVERY_MS = 10 * 60_000;

export interface LeaderRow {
  wallet: string;
  /** X handle when it's a bot (X) wallet. */
  handle: string | null;
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

interface Agg {
  usdc: number;
  tokens: Map<string, number>;
  /** bet vault → raw USDC staked in the window */
  staked: Map<string, number>;
  volume: number;
  trades: number;
}

/** Fold the window's records into one aggregate per wallet. */
export function aggregate(records: TradeRecord[]): Map<string, Agg> {
  const out = new Map<string, Agg>();
  for (const r of records) {
    const a = out.get(r.wallet) ?? {
      usdc: 0,
      tokens: new Map(),
      staked: new Map(),
      volume: 0,
      trades: 0,
    };
    a.usdc += r.usdc;
    for (const [mint, d] of Object.entries(r.tokens))
      a.tokens.set(mint, (a.tokens.get(mint) ?? 0) + d);
    // A trade moves the site's USDC (markets in other test tokens aren't ranked).
    if ((r.ix === "Swap" || r.ix === "BetCommit") && r.usdc !== 0) {
      a.volume += Math.abs(r.usdc);
      a.trades++;
    }
    if (r.ix === "BetCommit" && r.venue)
      a.staked.set(r.venue, (a.staked.get(r.venue) ?? 0) - r.usdc);
    out.set(r.wallet, a);
  }
  return out;
}

/** mint → value of one raw share (USDC raw): price for live markets, 1/0 once resolved. */
function shareValues(ctx: MoneyCtx, markets: Row[]): Map<string, number> {
  const out = new Map<string, number>();
  const usdc = ctx.custody.mint.toBase58();
  for (const m of markets) {
    if (m.collateralMint && m.collateralMint !== usdc) continue;
    const pk = new PublicKey(String(m.publicKey));
    const yes = m.resolved ? (num(m.winningSide) === 1 ? 1 : 0) : num(m.price);
    out.set(ctx.custody.client.yesMint(pk).toBase58(), yes);
    out.set(ctx.custody.client.noMint(pk).toBase58(), 1 - yes);
  }
  return out;
}

/** Current worth of the stakes placed in the window (pro-rata to the window's share). */
async function stakesWorth(ctx: MoneyCtx, wallet: string, a: Agg, bets: Row[]): Promise<number> {
  if (!a.staked.size) return 0;
  const client = ctx.custody.client;
  const owner = new PublicKey(wallet);
  const vaults = [...a.staked.keys()];
  const infos: (AccountInfo<Buffer> | null)[] = await client.connection.getMultipleAccountsInfo(
    vaults.map((v) => client.betPosition(new PublicKey(v), owner)),
  );
  let total = 0;
  infos.forEach((info, i) => {
    const v = bets.find((b) => b.publicKey === vaults[i]);
    if (!info || !v) return; // claimed/refunded already: the USDC is in a.usdc
    const p = client.program.coder.accounts.decode<BetPositionAccount>("betPosition", info.data);
    const yes = Number(p.yesAmount.toString());
    const no = Number(p.noAmount.toString());
    const share = Math.min(1, a.staked.get(vaults[i]!)! / Math.max(1, yes + no));
    total += stakeValue(v, yes, no) * share;
  });
  return total;
}

/** Rebuild the board from the 48h index (every 10 minutes; indexing runs every poll). */
export async function leaderboardPass(ctx: MoneyCtx): Promise<void> {
  const prev = await ctx.store.redis.get(LEADERBOARD_KEY);
  if (prev && Date.now() - (JSON.parse(prev) as { updatedAt: number }).updatedAt < EVERY_MS) return;
  const [records, lists, wallets] = await Promise.all([
    recentTrades(ctx.store),
    ctx.store.lists(),
    ctx.store.redis.hgetall("xwallets"),
  ]);
  const handles = new Map(
    Object.values(wallets).map((raw) => {
      const r = JSON.parse(raw) as { pubkey: string; handle: string };
      return [r.pubkey, r.handle] as const;
    }),
  );
  const prices = shareValues(ctx, lists.markets);
  const rows: LeaderRow[] = [];
  for (const [wallet, a] of aggregate(records)) {
    if (a.trades === 0) continue; // only claimed / refunded in the window: not ranked
    let shares = 0;
    for (const [mint, d] of a.tokens) shares += d * (prices.get(mint) ?? 0);
    const stakes = await stakesWorth(ctx, wallet, a, lists.betVaults).catch(() => 0);
    const r2 = (raw: number) => Math.round(raw / 1e4) / 100;
    rows.push({
      wallet,
      handle: handles.get(wallet) ?? null,
      pnl: r2(a.usdc + shares + stakes),
      volume: r2(a.volume),
      trades: a.trades,
    });
  }
  await ctx.store.redis.set(
    LEADERBOARD_KEY,
    JSON.stringify({ updatedAt: Date.now(), windowHours: 48, rows: rankRows(rows) }),
  );
  log.info("leaderboard updated", { traders: rows.length, trades: records.length });
}
