/**
 * Instruction builders for the 8 Bet Vault v2 instructions ("winner takes the
 * pot, the pot is the liquidity"). Collateral defaults to `ctx.collateralMint`;
 * pass the vault's own mint for any-token vaults.
 */
import { PublicKey, SystemProgram, type TransactionInstruction } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import type { BN } from "@anchor-lang/core";
import { type IxContext, bn } from "./context";
import { SYSVAR_RENT_PUBKEY } from "../constants";
import {
  deriveBetVaultPda,
  deriveBetPositionPda,
  deriveBetVaultCollateral,
  deriveLpPosition,
  deriveMarketPda,
  deriveYesMint,
  deriveNoMint,
  deriveMarketVault,
  deriveMetadataPda,
} from "../pda";
import { sideArg, type Side } from "../types/args";

type Amount = BN | number | bigint;

export async function buildInitializeBetVault(
  ctx: IxContext,
  p: {
    authority: PublicKey;
    vaultId: number | bigint;
    name: string;
    commitDurationSecs: number | bigint;
    marketDurationSecs: number | bigint;
    minTotal: Amount;
    lpBps: number;
    /** Omit → the authority resolves. */
    resolver?: PublicKey;
    allowlist?: PublicKey[];
    /** 0 (default) = 7 days. */
    voidGraceSecs?: number;
    collateralMint?: PublicKey;
  },
): Promise<TransactionInstruction> {
  const betVault = deriveBetVaultPda(ctx.programId, p.vaultId);
  const collateralMint = p.collateralMint ?? ctx.collateralMint;
  return ctx.program.methods
    .initializeBetVault(
      bn(p.vaultId),
      p.name,
      bn(p.commitDurationSecs),
      bn(p.marketDurationSecs),
      bn(p.minTotal),
      p.lpBps,
      p.resolver ?? PublicKey.default,
      p.allowlist ?? [],
      bn(p.voidGraceSecs ?? 0),
    )
    .accountsPartial({
      authority: p.authority,
      betVault,
      collateralMint,
      vaultCollateral: deriveBetVaultCollateral(betVault, collateralMint),
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    })
    .instruction();
}

export async function buildBetCommit(
  ctx: IxContext,
  p: {
    signer: PublicKey;
    betVault: PublicKey;
    side: Side;
    amount: Amount;
    collateralMint?: PublicKey;
  },
): Promise<TransactionInstruction> {
  const collateralMint = p.collateralMint ?? ctx.collateralMint;
  return ctx.program.methods
    .betCommit(sideArg(p.side), bn(p.amount))
    .accountsPartial({
      signer: p.signer,
      betVault: p.betVault,
      vaultCollateral: deriveBetVaultCollateral(p.betVault, collateralMint),
      userCollateral: await getAssociatedTokenAddress(collateralMint, p.signer),
      position: deriveBetPositionPda(ctx.programId, p.betVault, p.signer),
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
}

export async function buildLaunchBetVault(
  ctx: IxContext,
  p: {
    payer: PublicKey;
    betVault: PublicKey;
    marketId: number | bigint;
    collateralMint?: PublicKey;
  },
): Promise<TransactionInstruction> {
  const collateralMint = p.collateralMint ?? ctx.collateralMint;
  const market = deriveMarketPda(ctx.programId, p.marketId);
  const yesMint = deriveYesMint(ctx.programId, market);
  const noMint = deriveNoMint(ctx.programId, market);
  return ctx.program.methods
    .launchBetVault(bn(p.marketId))
    .accountsPartial({
      payer: p.payer,
      betVault: p.betVault,
      market,
      collateralMint,
      yesMint,
      noMint,
      marketVault: deriveMarketVault(ctx.programId, market),
      vaultCollateral: deriveBetVaultCollateral(p.betVault, collateralMint),
      vaultLpPosition: deriveLpPosition(ctx.programId, market, p.betVault),
      yesMetadata: deriveMetadataPda(yesMint, ctx.metaplexProgramId),
      noMetadata: deriveMetadataPda(noMint, ctx.metaplexProgramId),
      tokenMetadataProgram: ctx.metaplexProgramId,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .instruction();
}

export async function buildResolveBetVault(
  ctx: IxContext,
  p: { resolver: PublicKey; betVault: PublicKey; market: PublicKey; side: Side },
): Promise<TransactionInstruction> {
  return ctx.program.methods
    .resolveBetVault(sideArg(p.side))
    .accountsPartial({ resolver: p.resolver, betVault: p.betVault, market: p.market })
    .instruction();
}

export async function buildSettleBetVault(
  ctx: IxContext,
  p: { signer: PublicKey; betVault: PublicKey; market: PublicKey; collateralMint?: PublicKey },
): Promise<TransactionInstruction> {
  const collateralMint = p.collateralMint ?? ctx.collateralMint;
  return ctx.program.methods
    .settleBetVault()
    .accountsPartial({
      signer: p.signer,
      betVault: p.betVault,
      market: p.market,
      marketVault: deriveMarketVault(ctx.programId, p.market),
      vaultCollateral: deriveBetVaultCollateral(p.betVault, collateralMint),
      vaultLpPosition: deriveLpPosition(ctx.programId, p.market, p.betVault),
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
}

export async function buildVoidBetVault(
  ctx: IxContext,
  p: { signer: PublicKey; betVault: PublicKey; market: PublicKey; collateralMint?: PublicKey },
): Promise<TransactionInstruction> {
  const collateralMint = p.collateralMint ?? ctx.collateralMint;
  return ctx.program.methods
    .voidBetVault()
    .accountsPartial({
      signer: p.signer,
      betVault: p.betVault,
      market: p.market,
      marketVault: deriveMarketVault(ctx.programId, p.market),
      vaultCollateral: deriveBetVaultCollateral(p.betVault, collateralMint),
      vaultLpPosition: deriveLpPosition(ctx.programId, p.market, p.betVault),
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
}

/** Shared account set of `claim_bet` and `refund_bet`. */
async function positionAccounts(
  ctx: IxContext,
  p: { signer: PublicKey; betVault: PublicKey; collateralMint?: PublicKey },
) {
  const collateralMint = p.collateralMint ?? ctx.collateralMint;
  return {
    signer: p.signer,
    betVault: p.betVault,
    vaultCollateral: deriveBetVaultCollateral(p.betVault, collateralMint),
    userCollateral: await getAssociatedTokenAddress(collateralMint, p.signer),
    position: deriveBetPositionPda(ctx.programId, p.betVault, p.signer),
    tokenProgram: TOKEN_PROGRAM_ID,
  };
}

export async function buildClaimBet(
  ctx: IxContext,
  p: { signer: PublicKey; betVault: PublicKey; collateralMint?: PublicKey },
): Promise<TransactionInstruction> {
  return ctx.program.methods
    .claimBet()
    .accountsPartial(await positionAccounts(ctx, p))
    .instruction();
}

export async function buildRefundBet(
  ctx: IxContext,
  p: { signer: PublicKey; betVault: PublicKey; collateralMint?: PublicKey },
): Promise<TransactionInstruction> {
  return ctx.program.methods
    .refundBet()
    .accountsPartial(await positionAccounts(ctx, p))
    .instruction();
}
