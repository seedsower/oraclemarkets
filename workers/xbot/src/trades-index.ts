import type { ParsedTransactionWithMeta, PublicKey } from "@solana/web3.js";
import type { PmAmmClient } from "@pm-amm/sdk";
import { log } from "./log";
import type { Store } from "./store";

/**
 * A rolling 48-hour index of trading activity on the program, for the
 * leaderboard. Every poll it reads new program transactions (signature
 * cursor), keeps the ones that move a trader's money, and stores a compact
 * record in the sorted set `trades:48h` (score = block time), trimmed to 48h.
 *
 * The trader is the transaction's signer other than the bot wallet (the bot
 * pays fees for X wallets). Only trading instructions count; liquidity and
 * market-admin instructions are ignored.
 */
export const WINDOW_SECS = 48 * 3600;
const SET = "trades:48h";
const CURSOR = "trades:cursor";
const TRADING = new Set([
  "Swap",
  "BetCommit",
  "ClaimBet",
  "RefundBet",
  "ClaimWinnings",
  "RedeemPair",
]);

export interface TradeRecord {
  sig: string;
  wallet: string;
  t: number;
  ix: string;
  /** Collateral (raw) change for the trader: − spent, + received. */
  usdc: number;
  /** Other token changes for the trader (raw), by mint. */
  tokens: Record<string, number>;
  /** Who the collateral moved to/from (a bet vault for stakes / claims). */
  venue: string | null;
}

/** The program instruction names in a transaction's logs. */
function ixNames(tx: ParsedTransactionWithMeta, programId: string): string[] {
  const out: string[] = [];
  let inProgram = false;
  for (const l of tx.meta?.logMessages ?? []) {
    if (l.startsWith(`Program ${programId} invoke`)) inProgram = true;
    else if (l.startsWith("Program ") && l.includes(" invoke")) inProgram = false;
    const m = inProgram ? l.match(/^Program log: Instruction: (\w+)/) : null;
    if (m) out.push(m[1]!);
  }
  return out;
}

/** Owner of the collateral account on the other side of the trader's USDC move. */
function venueOf(tx: ParsedTransactionWithMeta, collateral: string, wallet: string): string | null {
  const pre = new Map((tx.meta?.preTokenBalances ?? []).map((b) => [b.accountIndex, b]));
  for (const b of tx.meta?.postTokenBalances ?? []) {
    if (b.mint !== collateral || b.owner === wallet || !b.owner) continue;
    const before = Number(pre.get(b.accountIndex)?.uiTokenAmount.amount ?? 0);
    if (Number(b.uiTokenAmount.amount) !== before) return b.owner;
  }
  return null;
}

/** One trading transaction → a record (null if it's not a trade or failed). */
export function toRecord(
  sig: string,
  tx: ParsedTransactionWithMeta,
  ctx: { programId: string; collateral: string; bot: string },
): TradeRecord | null {
  if (!tx.meta || tx.meta.err) return null;
  // Pure trades only: a creator seeding a market (liquidity + a seeding swap
  // in one tx) is market making, not a trade.
  const names = ixNames(tx, ctx.programId);
  if (!names.length || !names.every((n) => TRADING.has(n))) return null;
  const ix = names[0]!;
  const signers = tx.transaction.message.accountKeys
    .filter((k) => k.signer)
    .map((k) => k.pubkey.toBase58());
  const wallet = signers.find((s) => s !== ctx.bot);
  if (!wallet) return null;
  const tokens: Record<string, number> = {};
  const add = (mint: string, amount: number) => (tokens[mint] = (tokens[mint] ?? 0) + amount);
  for (const b of tx.meta.postTokenBalances ?? [])
    if (b.owner === wallet) add(b.mint, Number(b.uiTokenAmount.amount));
  for (const b of tx.meta.preTokenBalances ?? [])
    if (b.owner === wallet) add(b.mint, -Number(b.uiTokenAmount.amount));
  const usdc = tokens[ctx.collateral] ?? 0;
  delete tokens[ctx.collateral];
  for (const [mint, d] of Object.entries(tokens)) if (d === 0) delete tokens[mint];
  if (usdc === 0 && Object.keys(tokens).length === 0) return null;
  return {
    sig,
    wallet,
    t: tx.blockTime ?? 0,
    ix,
    usdc,
    tokens,
    venue: venueOf(tx, ctx.collateral, wallet),
  };
}

/** Program signatures newer than the cursor and inside the window, oldest first. */
async function newSignatures(client: PmAmmClient, cursor: string | null, since: number) {
  const out: { signature: string; blockTime?: number | null }[] = [];
  let before: string | undefined;
  for (let page = 0; page < 10; page++) {
    const sigs = await client.connection.getSignaturesForAddress(client.programId as PublicKey, {
      before,
      until: cursor ?? undefined,
      limit: 1000,
    });
    const fresh = sigs.filter((s) => !s.err && (s.blockTime ?? 0) >= since);
    out.push(...fresh);
    if (sigs.length < 1000 || fresh.length < sigs.length) break;
    before = sigs[sigs.length - 1]!.signature;
  }
  return out.reverse();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Gentle on the public RPC: one transaction at a time, a few dozen per poll. */
const MAX_PER_PASS = 40;
const SPACING_MS = 300;

/**
 * Read up to MAX_PER_PASS new program transactions (oldest first) into the 48h
 * set, advancing the cursor after each one, then drop anything older than
 * 48h. The first run backfills the window over a few polls.
 */
export async function indexTrades(client: PmAmmClient, store: Store, bot: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const cursor = await store.redis.get(CURSOR);
  const sigs = (await newSignatures(client, cursor, now - WINDOW_SECS)).slice(0, MAX_PER_PASS);
  const ctx = {
    programId: client.programId.toBase58(),
    collateral: client.collateralMint.toBase58(),
    bot,
  };
  let added = 0;
  for (const s of sigs) {
    let tx: ParsedTransactionWithMeta | null;
    try {
      tx = await client.connection.getParsedTransaction(s.signature, {
        maxSupportedTransactionVersion: 0,
        commitment: "confirmed",
      });
    } catch (e) {
      log.warn("trade index paused (RPC)", { error: String(e).slice(0, 100) });
      break; // resume from the cursor next poll
    }
    const rec = tx ? toRecord(s.signature, tx, ctx) : null;
    const m = store.redis.multi();
    if (rec) (m.zadd(SET, rec.t, JSON.stringify(rec)), added++);
    await m.set(CURSOR, s.signature).exec();
    await sleep(SPACING_MS);
  }
  await store.redis.zremrangebyscore(SET, 0, now - WINDOW_SECS);
  if (sigs.length) log.info("indexed trades", { added, scanned: sigs.length });
}

export async function recentTrades(store: Store): Promise<TradeRecord[]> {
  const now = Math.floor(Date.now() / 1000);
  const raw = await store.redis.zrangebyscore(SET, now - WINDOW_SECS, "+inf");
  return raw.map((r) => JSON.parse(r) as TradeRecord);
}
