/**
 * Typed shapes for the program's 9 accounts — kept aligned with
 * `anchor/programs/pm_amm/src/state.rs`. Anchor decodes every field; these
 * interfaces type the fields callers use (padding/`_reserved` fields are
 * present at runtime but intentionally omitted here).
 *
 * Anchor returns u64/u128/i64/i128 as `BN` and pubkeys as `PublicKey`.
 */
import type { BN } from "@anchor-lang/core";
import type { PublicKey } from "@solana/web3.js";

type Bn = BN;
type Pk = PublicKey;

export interface MarketAccount {
  authority: Pk;
  marketId: Bn;
  collateralMint: Pk;
  yesMint: Pk;
  noMint: Pk;
  vault: Pk;
  startTs: Bn;
  endTs: Bn;
  lZero: Bn;
  reserveYes: Bn;
  reserveNo: Bn;
  lastAccrualTs: Bn;
  cumYesPerShare: Bn;
  cumNoPerShare: Bn;
  totalYesDistributed: Bn;
  totalNoDistributed: Bn;
  totalLpShares: Bn;
  resolved: boolean;
  winningSide: number;
  bump: number;
  name: number[];
  /** EXTENSION: seed price in bps. 0 = legacy 50/50. */
  initialPriceBps: number;
  /** EXTENSION: GroupMarket PDA this leg is attached to (default = standalone). */
  group: Pk;
  /** Entry-side surplus owed to LPs, not yet minted (counted by the solvency guard). */
  unclaimedExcessYes: Bn;
  unclaimedExcessNo: Bn;
}

export interface GroupMarketAccount {
  authority: Pk;
  groupId: Bn;
  startTs: Bn;
  endTs: Bn;
  legCount: number;
  legs: Pk[];
  resolved: boolean;
  /** 0xFF until resolved, else index of the winning leg. */
  winningLeg: number;
  bump: number;
  name: number[];
  /** Cumulative seeded bps across attached legs (Σ p_i × 10_000). */
  totalSeededBps: number;
}

export interface LpPositionAccount {
  owner: Pk;
  market: Pk;
  shares: Bn;
  collateralDeposited: Bn;
  yesPerShareCheckpoint: Bn;
  noPerShareCheckpoint: Bn;
  bump: number;
  /** Entry-side surplus owed to this LP — minted by claimLpResiduals / withdraw. */
  excessYes: Bn;
  excessNo: Bn;
}

/** Binary commitment vault (Sprint 22). */
export interface CommitmentVaultAccount {
  authority: Pk;
  vaultId: Bn;
  collateralMint: Pk;
  name: number[];
  commitEndTs: Bn;
  marketEndTs: Bn;
  yesTotal: Bn;
  noTotal: Bn;
  commitCount: number;
  minTotal: Bn;
  launched: boolean;
  /** Launch price (yes_total / total × 10_000), kept post-launch. */
  winningPriceBps: number;
  /** Launched Market PDA; default (all-zero) pre-launch. */
  market: Pk;
  /** Vault's LpPosition on the market; set if the vault later deposits. */
  lpPosition: Pk;
  bump: number;
}

/** Bet Vault v2 — winner takes the pot, the pot is the liquidity. */
export interface BetVaultAccount {
  authority: Pk;
  /** Only key allowed to resolve (launch: authority or resolver). */
  resolver: Pk;
  vaultId: Bn;
  collateralMint: Pk;
  name: number[];
  commitEndTs: Bn;
  marketEndTs: Bn;
  yesTotal: Bn;
  noTotal: Bn;
  commitCount: number;
  minTotal: Bn;
  /** Requested share of the pot deposited as liquidity (bps). */
  lpBps: number;
  /** Share actually deposited at launch: min(lpBps, favourite's share). */
  effectiveLpBps: number;
  allowlistLen: number;
  allowlist: Pk[];
  launched: boolean;
  /** Launch odds (bps of YES) implied by the stakes. */
  priceBps: number;
  market: Pk;
  /** 0 until settled, then 1 = YES, 2 = NO. */
  winningSide: number;
  settled: boolean;
  /** Vault balance frozen at settlement — what the winning side splits. */
  payoutPool: Bn;
  claimedStake: Bn;
  paidOut: Bn;
  refunding: boolean;
  /** Grace period after market end before `void_bet_vault` opens (seconds). */
  voidGraceSecs: Bn;
  /** True once voided: `claim_bet` refunds every committer pro-rata. */
  voided: boolean;
  bump: number;
}

/** Per-committer stake in a bet vault. */
export interface BetPositionAccount {
  vault: Pk;
  owner: Pk;
  yesAmount: Bn;
  noAmount: Bn;
  bump: number;
}

/** Per-committer position in a binary commitment vault. */
export interface CommitPositionAccount {
  vault: Pk;
  owner: Pk;
  yesAmount: Bn;
  noAmount: Bn;
  claimed: boolean;
  bump: number;
}

/** Multi-outcome commitment vault (Sprint 23). */
export interface CommitmentVaultGroupAccount {
  authority: Pk;
  vaultId: Bn;
  collateralMint: Pk;
  name: number[];
  legCount: number;
  /** Per-leg label, [u8; 32] zero-padded. */
  legNames: number[][];
  /** Per-leg committed USDC totals (raw u64, 6 decimals). */
  legTotals: Bn[];
  commitEndTs: Bn;
  marketEndTs: Bn;
  commitCount: number;
  minTotal: Bn;
  groupMarketInitialized: boolean;
  legsLaunched: number;
  groupMarket: Pk;
  bump: number;
}

/** Per-committer position in a multi-outcome commitment vault. */
export interface CommitPositionGroupAccount {
  vault: Pk;
  owner: Pk;
  legAmounts: Bn[];
  claimed: boolean;
  bump: number;
}

// ----------------------------------------------------------------------------
// Anchor account-namespace shapes — the typed surface for `program.account.<x>`
// ----------------------------------------------------------------------------

export interface AccountFetcher<T> {
  fetch(address: Pk): Promise<T>;
  fetchNullable(address: Pk): Promise<T | null>;
  all(filters?: { dataSize: number }[]): Promise<{ publicKey: Pk; account: T }[]>;
}

export interface ProgramAccountNamespace {
  market: AccountFetcher<MarketAccount>;
  groupMarket: AccountFetcher<GroupMarketAccount>;
  lpPosition: AccountFetcher<LpPositionAccount>;
  commitmentVault: AccountFetcher<CommitmentVaultAccount>;
  commitPosition: AccountFetcher<CommitPositionAccount>;
  commitmentVaultGroup: AccountFetcher<CommitmentVaultGroupAccount>;
  commitPositionGroup: AccountFetcher<CommitPositionGroupAccount>;
  betVault: AccountFetcher<BetVaultAccount>;
  betPosition: AccountFetcher<BetPositionAccount>;
}
