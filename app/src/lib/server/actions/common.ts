import { NextResponse } from "next/server";
import { createActionHeaders, type ActionError } from "@solana/actions";
import {
  ComputeBudgetProgram,
  PublicKey,
  VersionedTransaction,
  type Transaction,
} from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { IS_MAINNET, PROGRAM_ID } from "@/lib/constants";

/** Solana Actions spec version these routes implement. */
export const ACTION_VERSION = "2.4";

/** CORS + X-Action-Version + X-Blockchain-Ids (mainnet vs devnet from the cluster). */
export const ACTION_HEADERS: Record<string, string> = createActionHeaders({
  chainId: IS_MAINNET ? "mainnet" : "devnet",
  actionVersion: ACTION_VERSION,
});

function envNum(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const ACTIONS_CONFIG = {
  maxUsdc: envNum("ACTIONS_MAX_USDC", 250),
  minUsdc: 1,
  slippageBps: Math.floor(envNum("ACTIONS_SLIPPAGE_BPS", 200)),
  featuredOnly: process.env.ACTIONS_FEATURED_ONLY === "true",
};

export function actionJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: ACTION_HEADERS });
}

export function actionError(message: string, status = 400): NextResponse {
  const body: ActionError = { message };
  return actionJson(body, status);
}

export function actionOptions(): Response {
  return new Response(null, { status: 204, headers: ACTION_HEADERS });
}

/** A wallet that can sign: valid base58 AND on the ed25519 curve (not a PDA). */
export function parseAccount(raw: unknown): PublicKey | null {
  if (typeof raw !== "string" || raw.length < 32 || raw.length > 44) return null;
  try {
    const pk = new PublicKey(raw);
    return pk.toBase58() === raw && PublicKey.isOnCurve(pk.toBytes()) ? pk : null;
  } catch {
    return null;
  }
}

export type Side = "yes" | "no";

export function parseSide(raw: string | null): Side | null {
  return raw === "yes" || raw === "no" ? raw : null;
}

/** Whole or 2-decimal USDC amount within [minUsdc, maxUsdc]. */
export function parseAmount(raw: string | null): number | null {
  if (raw === null || !/^\d{1,7}(\.\d{1,2})?$/.test(raw.trim())) return null;
  const n = Number(raw);
  return n >= ACTIONS_CONFIG.minUsdc && n <= ACTIONS_CONFIG.maxUsdc ? n : null;
}

/**
 * The only programs a returned transaction may invoke at the top level. The
 * Token program is deliberately NOT listed: our swaps never emit a top-level
 * Token instruction (token moves happen via CPI inside the pm-AMM program, and
 * ATA creates go through the Associated Token program), so a bare SPL transfer
 * here could only be a drain — it's refused.
 */
export const ALLOWED_PROGRAM_IDS: ReadonlySet<string> = new Set([
  ComputeBudgetProgram.programId.toBase58(),
  ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),
  PROGRAM_ID.toBase58(),
]);

/** Program ids invoked by a serialized (base64) or in-memory transaction. */
export function invokedPrograms(tx: string | Transaction | VersionedTransaction): string[] {
  const vtx =
    typeof tx === "string"
      ? VersionedTransaction.deserialize(Buffer.from(tx, "base64"))
      : tx instanceof VersionedTransaction
        ? tx
        : new VersionedTransaction(tx.compileMessage());
  const keys = vtx.message.staticAccountKeys;
  return vtx.message.compiledInstructions.map((ix) => keys[ix.programIdIndex]!.toBase58());
}

/** Throws unless every instruction targets an allowed program. */
export function assertAllowedPrograms(tx: string | Transaction | VersionedTransaction): void {
  const bad = invokedPrograms(tx).filter((p) => !ALLOWED_PROGRAM_IDS.has(p));
  if (bad.length) throw new Error(`refusing to return tx invoking ${[...new Set(bad)].join(", ")}`);
}
