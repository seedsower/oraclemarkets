/**
 * Swap transaction building, shared by `send.swap` (signs with the bound
 * provider) and server-side builders like Solana Actions (return the
 * instructions unsigned for the user's wallet). One place for the swap's
 * pre-instructions so the two paths can't drift.
 */
import type { PublicKey, TransactionInstruction } from "@solana/web3.js";
import type { BN } from "@anchor-lang/core";
import { getMint } from "@solana/spl-token";
import type { PmAmmClient } from "../client";
import { CU, PROTOCOL_DAO, SWAP_FEE_BPS } from "../constants";
import { quoteSwap, type SwapMode } from "../math";
import type { MarketAccount } from "../types/accounts";
import type { SwapDirection } from "../types/args";
import { computeBudgetIx, ensureAtaIdempotentIx } from "../util/ata";
import { marketView, quoteReserves } from "../views";

export interface SwapIxsInput {
  signer: PublicKey;
  market: PublicKey;
  direction: SwapDirection;
  /** Raw base units of the input token. */
  amountIn: number | bigint | BN;
  /** Raw base units — the swap reverts below this. */
  minOutput: number | bigint | BN;
  /** Pre-fetched market account (skips one RPC read). */
  account?: MarketAccount;
}

/**
 * Compute budget + idempotent ATA creates (signer's YES / NO / collateral, the
 * protocol DAO's and — when the signer isn't the creator — the creator's
 * collateral ATA, both off-curve allowed) + the `swap` instruction. Fee payer
 * for the creates is the signer.
 */
export async function buildSwapIxs(
  client: PmAmmClient,
  input: SwapIxsInput,
): Promise<TransactionInstruction[]> {
  const { signer, market } = input;
  const m = input.account ?? (await client.fetchMarket(market));
  if (!m) throw new Error("swap: market not found");
  const authority = m.authority as PublicKey;
  const collateralMint = m.collateralMint as PublicKey;
  const conn = client.connection;

  const atas: [PublicKey, PublicKey, boolean][] = [
    [signer, client.yesMint(market), false],
    [signer, client.noMint(market), false],
    [signer, collateralMint, false],
    // 2% fee → 50% DAO (off-curve), 50% creator; the creator keeps their own
    // share when they trade (then `creatorUsdc` is null on-chain).
    [PROTOCOL_DAO, collateralMint, true],
  ];
  // Off-curve allowed: a bet vault's authority is its PDA.
  if (!authority.equals(signer)) atas.push([authority, collateralMint, true]);

  const pre: TransactionInstruction[] = [];
  for (const [owner, mint, offCurve] of atas) {
    const { ix } = await ensureAtaIdempotentIx(conn, signer, owner, mint, offCurve);
    if (ix) pre.push(ix);
  }
  const ix = await client.ix.swap({
    signer,
    market,
    direction: input.direction,
    amountIn: input.amountIn,
    minOutput: input.minOutput,
    creatorAuthority: authority,
    collateralMint,
  });
  return [computeBudgetIx(CU.HEAVY), ...pre, ix];
}

export interface BuildSwapTxInput {
  signer: PublicKey;
  market: PublicKey;
  /** Collateral → YES/NO (buy) or YES/NO → collateral (sell). */
  direction: Extract<SwapDirection, "usdcToYes" | "usdcToNo" | "yesToUsdc" | "noToUsdc">;
  /** Human units of the input token (e.g. 25 = 25 USDC on a buy). */
  amount: number;
  /** Slippage tolerance applied to the quote for `minOutput` (200 = 2%). */
  slippageBps: number;
}

export interface BuiltSwap {
  instructions: TransactionInstruction[];
  account: MarketAccount;
  collateralMint: PublicKey;
  decimals: number;
  amountIn: number;
  /** Quoted output (raw), fee-aware; `minOutput` = quote × (1 − slippage). */
  quotedOutput: number;
  minOutput: number;
  /** YES probability before the trade (display price). */
  priceBefore: number;
}

function modeSide(d: BuildSwapTxInput["direction"]): { mode: SwapMode; side: "yes" | "no" } {
  if (d === "usdcToYes") return { mode: "buy", side: "yes" };
  if (d === "usdcToNo") return { mode: "buy", side: "no" };
  return { mode: "sell", side: d === "yesToUsdc" ? "yes" : "no" };
}

/** Fetch, quote (SDK math), apply slippage, and build — nothing is signed or sent. */
export async function buildSwapTx(
  client: PmAmmClient,
  input: BuildSwapTxInput,
): Promise<BuiltSwap> {
  if (!(input.amount > 0)) throw new Error("swap: amount must be positive");
  if (input.slippageBps < 0 || input.slippageBps >= 10_000) throw new Error("swap: bad slippage");
  const account = await client.fetchMarket(input.market);
  if (!account) throw new Error("swap: market not found");
  const collateralMint = account.collateralMint as PublicKey;
  const { decimals } = await getMint(client.connection, collateralMint);

  const view = marketView(input.market.toBase58(), account, Math.floor(Date.now() / 1000));
  const amountIn = Math.floor(input.amount * 10 ** decimals);
  const { mode, side } = modeSide(input.direction);
  const { output } = quoteSwap(quoteReserves(view), mode, side, amountIn, SWAP_FEE_BPS);
  if (output <= 0) throw new Error("swap: quote is zero (no liquidity?)");
  const minOutput = Math.floor((output * (10_000 - input.slippageBps)) / 10_000);

  const instructions = await buildSwapIxs(client, {
    signer: input.signer,
    market: input.market,
    direction: input.direction,
    amountIn,
    minOutput,
    account,
  });
  return {
    instructions,
    account,
    collateralMint,
    decimals,
    amountIn,
    quotedOutput: output,
    minOutput,
    priceBefore: view.price,
  };
}
