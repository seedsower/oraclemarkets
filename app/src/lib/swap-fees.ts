"use client";

/**
 * Fee-recipient accounts for SIMULATED swaps (quotes, position values).
 *
 * `swap` only accepts `creatorUsdc = null` when the signer IS the market
 * authority — otherwise any trader could keep the creator's half of the fee.
 * A simulation must therefore pass the real creator ATA, creating it in the
 * same tx when missing (it can be off-curve: a bet vault PDA is the authority
 * of its market).
 */
import type { Connection, PublicKey, TransactionInstruction } from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import type { PmAmmClient } from "@pm-amm/sdk";

/** market PDA → market.authority. Immutable once the market exists. */
const authorityCache = new Map<string, PublicKey>();

export async function marketAuthority(
  client: PmAmmClient,
  market: PublicKey,
): Promise<PublicKey | null> {
  const key = market.toBase58();
  const cached = authorityCache.get(key);
  if (cached) return cached;
  const m = await client.fetchMarket(market);
  if (!m) return null;
  const authority = m.authority as PublicKey;
  authorityCache.set(key, authority);
  return authority;
}

/** Create-ATA ix for the creator's fee account when the payer isn't the creator
 *  and the account doesn't exist yet; otherwise none. */
export async function creatorFeeAtaIxs(
  connection: Connection,
  payer: PublicKey,
  collateralMint: PublicKey,
  creator: PublicKey,
): Promise<TransactionInstruction[]> {
  if (creator.equals(payer)) return [];
  const ata = await getAssociatedTokenAddress(collateralMint, creator, true);
  if (await connection.getAccountInfo(ata)) return [];
  return [createAssociatedTokenAccountInstruction(payer, ata, creator, collateralMint)];
}
