import { betVaultView, deriveBetVaultPda, type BetVaultView } from "@pm-amm/sdk";
import { PROGRAM_ID } from "@/lib/constants";
import { LIST_CACHE } from "@/lib/list-cache";
import { redis } from "@/lib/redis";
import { serverClient } from "@/lib/server/chain";
import type { BetMeta } from "@/lib/bets";

/** Bet vault by id — keeper cache first, one RPC read as the fallback. */
export async function getBetById(vaultId: number): Promise<BetVaultView | null> {
  try {
    const raw = redis ? await redis.get(LIST_CACHE.betVaults) : null;
    const rows = raw ? ((JSON.parse(raw) as { items?: BetVaultView[] }).items ?? []) : [];
    const hit = rows.find((v) => v.vaultId === vaultId);
    if (hit) return hit;
  } catch {
    // fall through to RPC
  }
  try {
    const pda = deriveBetVaultPda(PROGRAM_ID, vaultId);
    const acc = await serverClient().fetchBetVault(pda);
    return acc ? betVaultView(pda.toBase58(), acc) : null;
  } catch {
    return null;
  }
}

/** Off-chain context written by the X bot when it opened the bet (if it did). */
export async function getBetMeta(vaultId: number): Promise<BetMeta | null> {
  try {
    const raw = redis ? await redis.get(`bets:meta:${vaultId}`) : null;
    return raw ? (JSON.parse(raw) as BetMeta) : null;
  } catch {
    return null;
  }
}
