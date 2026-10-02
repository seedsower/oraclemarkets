import { betPayout, type BetVaultView } from "@pm-amm/sdk";
import type { BuySide } from "@/lib/share";

/**
 * Bets (Bet Vault v2) for the web: links and payout previews. Pure — shared
 * by pages, the share card and tests. On-chain rules: instructions/bet/*.
 */
export const DEFAULT_STAKE_USDC = 10;

export const betPath = (vaultId: number | string) => `/bet/${vaultId}`;

/** One-tap stake link (same `?buy=…&amount=…` intent the market pages use). */
export function betStakePath(vaultId: number | string, side: BuySide, amount = DEFAULT_STAKE_USDC) {
  return `${betPath(vaultId)}?buy=${side}&amount=${amount}`;
}

/** Off-chain context the X bot stores with a bet (`bets:meta:<vaultId>`). */
export interface BetMeta {
  vaultId: number;
  /** Full question (on-chain name is capped at 64 bytes). */
  question: string;
  /** The post the bet was opened on. */
  sourceUrl: string | null;
  /** Who tagged the bot ("bet?"). */
  openedBy: string | null;
  deadline: string | null;
  createdAt: number;
}

export interface MyBet {
  yes: number; // raw stake
  no: number;
}

/**
 * What this wallet gets from a settled or voided vault: winners split the pool
 * pro-rata to their winning stake; voided vaults refund every stake pro-rata.
 * (On-chain the final claim also sweeps a lamport or two of rounding dust.)
 */
export function previewClaim(
  v: Pick<
    BetVaultView,
    "settled" | "voided" | "winningSide" | "payoutPool" | "yesTotal" | "noTotal"
  >,
  me: MyBet,
): { stake: number; payout: number; outcome: "won" | "lost" | "refund" | "pending" } {
  if (v.voided) {
    const stake = me.yes + me.no;
    return {
      stake,
      payout: betPayout(v.payoutPool, stake, v.yesTotal + v.noTotal),
      outcome: "refund",
    };
  }
  if (!v.settled) return { stake: me.yes + me.no, payout: 0, outcome: "pending" };
  const yesWon = v.winningSide === 1;
  const stake = yesWon ? me.yes : me.no;
  const basis = yesWon ? v.yesTotal : v.noTotal;
  if (stake <= 0) return { stake: 0, payout: 0, outcome: "lost" };
  return { stake, payout: betPayout(v.payoutPool, stake, basis), outcome: "won" };
}
