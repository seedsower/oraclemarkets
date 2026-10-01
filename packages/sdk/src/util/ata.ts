/**
 * Associated-token-account helpers used by `send.*` wrappers and flows.
 */
import type { Connection, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { ComputeBudgetProgram } from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddress,
} from "@solana/spl-token";

/**
 * Resolve `owner`'s ATA for `mint`; if it doesn't exist yet, also return a
 * create instruction (payer funds it). `ix` is null when the ATA is present.
 */
export async function ensureAtaIx(
  connection: Connection,
  payer: PublicKey,
  owner: PublicKey,
  mint: PublicKey,
  allowOwnerOffCurve = false,
): Promise<{ ata: PublicKey; ix: TransactionInstruction | null }> {
  const ata = await getAssociatedTokenAddress(mint, owner, allowOwnerOffCurve);
  const info = await connection.getAccountInfo(ata);
  const ix = info ? null : createAssociatedTokenAccountInstruction(payer, ata, owner, mint);
  return { ata, ix };
}

/**
 * Like `ensureAtaIx`, but the create is IDEMPOTENT — safe for transactions
 * built now and signed later (e.g. Solana Actions), where the ATA may appear
 * in between. Still only emitted when the ATA is missing (keeps txs small).
 */
export async function ensureAtaIdempotentIx(
  connection: Connection,
  payer: PublicKey,
  owner: PublicKey,
  mint: PublicKey,
  allowOwnerOffCurve = false,
): Promise<{ ata: PublicKey; ix: TransactionInstruction | null }> {
  const ata = await getAssociatedTokenAddress(mint, owner, allowOwnerOffCurve);
  const info = await connection.getAccountInfo(ata);
  const ix = info
    ? null
    : createAssociatedTokenAccountIdempotentInstruction(payer, ata, owner, mint);
  return { ata, ix };
}

/** Compute-budget preinstruction. */
export function computeBudgetIx(units: number): TransactionInstruction {
  return ComputeBudgetProgram.setComputeUnitLimit({ units });
}
