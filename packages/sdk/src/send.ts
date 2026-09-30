/**
 * `send.*` — convenience wrappers that build an instruction, prepend a
 * compute-budget preinstruction (+ any missing ATA creates), and send+confirm
 * via the bound provider. Mirrors the semantics of the app's former `run*`
 * helpers. For binary markets, human amounts are converted to the MARKET's
 * collateral decimals (any SPL token); `swap`/`redeemPair` amounts are RAW base
 * units. Vault flows are still USDC (6dp) pending the vault-collateral phase.
 */
import type { PublicKey, TransactionInstruction } from "@solana/web3.js";
import type { BN } from "@anchor-lang/core";
import { getMint } from "@solana/spl-token";
import type { PmAmmClient } from "./client";
import { CU, PROTOCOL_DAO } from "./constants";
import { toRaw } from "./math";
import { randomU48 } from "./encoding";
import { ensureAtaIx, computeBudgetIx } from "./util/ata";
import type {
  Side,
  SwapDirection,
  CreateMarketInput,
  CreateVaultInput,
  CreateVaultGroupInput,
  CreateBetVaultInput,
} from "./types/args";

const usdc = (human: number): number => Math.floor(human * 1e6);

export type SendApi = ReturnType<typeof makeSend>;

export function makeSend(client: PmAmmClient) {
  /** Create-ATA preinstructions for the wallet's ATAs of the given mints. */
  async function ataPreIxs(mints: PublicKey[]): Promise<TransactionInstruction[]> {
    const owner = client.walletPubkey();
    const out: TransactionInstruction[] = [];
    for (const mint of mints) {
      const { ix } = await ensureAtaIx(client.connection, owner, owner, mint);
      if (ix) out.push(ix);
    }
    return out;
  }

  /** A binary market's collateral mint + its decimals (any SPL token). */
  async function collateralOf(market: PublicKey): Promise<{ mint: PublicKey; decimals: number }> {
    const m = await client.fetchMarket(market);
    if (!m) throw new Error("market not found");
    const mint = m.collateralMint as PublicKey;
    return { mint, decimals: (await getMint(client.connection, mint)).decimals };
  }

  return {
    // ---- binary market ----
    async createMarket(input: CreateMarketInput) {
      const authority = client.walletPubkey();
      const marketId = randomU48();
      const market = client.marketPda(marketId);
      const endTs = Math.floor(Date.now() / 1000) + input.durationSecs;
      const collateralMint = input.collateralMint ?? client.collateralMint;
      const ixs: TransactionInstruction[] = [computeBudgetIx(CU.HEAVY)];
      ixs.push(
        await client.ix.initializeMarket({
          authority,
          marketId,
          endTs,
          name: input.name,
          initialPriceBps: input.initialPriceBps ?? 0,
          collateralMint,
        }),
      );
      if (input.depositUsdc && input.depositUsdc > 0) {
        const decimals = (await getMint(client.connection, collateralMint)).decimals;
        ixs.push(...(await ataPreIxs([collateralMint])));
        ixs.push(
          await client.ix.depositLiquidity({
            signer: authority,
            market,
            amount: toRaw(input.depositUsdc, decimals),
            collateralMint,
          }),
        );
      }
      const signature = await client.sendIxs(ixs);
      return { marketId, marketPda: market.toBase58(), signature };
    },

    async swap(
      market: PublicKey,
      direction: SwapDirection,
      amountInMicro: number | BN,
      minOutputMicro: number | BN,
    ) {
      const signer = client.walletPubkey();
      const m = await client.fetchMarket(market);
      if (!m) throw new Error("swap: market not found");
      const authority = m.authority as PublicKey;
      const collateralMint = m.collateralMint as PublicKey;
      const pre = await ataPreIxs([client.yesMint(market), client.noMint(market), collateralMint]);
      // Ensure the fee-recipient ATAs exist (2% fee → 50% DAO, 50% creator), in
      // the MARKET's collateral. Idempotent; payer is the swapper. DAO is off-curve.
      const { ix: daoAta } = await ensureAtaIx(
        client.connection,
        signer,
        PROTOCOL_DAO,
        collateralMint,
        true,
      );
      if (daoAta) pre.push(daoAta);
      // Creator ATA only when the swapper is NOT the creator (otherwise the
      // creator keeps their share and `creatorUsdc` is passed as null).
      if (!authority.equals(signer)) {
        // Off-curve allowed: a bet vault's authority is its PDA.
        const { ix: creatorAta } = await ensureAtaIx(
          client.connection,
          signer,
          authority,
          collateralMint,
          true,
        );
        if (creatorAta) pre.push(creatorAta);
      }
      const ix = await client.ix.swap({
        signer,
        market,
        direction,
        amountIn: amountInMicro,
        minOutput: minOutputMicro,
        creatorAuthority: authority,
        collateralMint,
      });
      return client.sendIxs([computeBudgetIx(CU.HEAVY), ...pre, ix]);
    },

    async depositLiquidity(market: PublicKey, amountUsdc: number) {
      const signer = client.walletPubkey();
      const { mint, decimals } = await collateralOf(market);
      const pre = await ataPreIxs([mint]);
      const ix = await client.ix.depositLiquidity({
        signer,
        market,
        amount: toRaw(amountUsdc, decimals),
        collateralMint: mint,
      });
      return client.sendIxs([computeBudgetIx(CU.HEAVY), ...pre, ix]);
    },

    async withdrawLiquidity(market: PublicKey, sharesToBurn: BN | number) {
      const signer = client.walletPubkey();
      const { mint } = await collateralOf(market);
      const pre = await ataPreIxs([client.yesMint(market), client.noMint(market)]);
      const ix = await client.ix.withdrawLiquidity({
        signer,
        market,
        sharesToBurn,
        collateralMint: mint,
      });
      return client.sendIxs([computeBudgetIx(CU.HEAVY), ...pre, ix]);
    },

    async redeemPair(market: PublicKey, amountMicro: number | BN) {
      const signer = client.walletPubkey();
      const { mint } = await collateralOf(market);
      const pre = await ataPreIxs([client.yesMint(market), client.noMint(market), mint]);
      const ix = await client.ix.redeemPair({
        signer,
        market,
        amount: amountMicro,
        collateralMint: mint,
      });
      return client.sendIxs([computeBudgetIx(CU.DEFAULT), ...pre, ix]);
    },

    async claimWinnings(market: PublicKey) {
      const signer = client.walletPubkey();
      const { mint } = await collateralOf(market);
      const pre = await ataPreIxs([client.yesMint(market), client.noMint(market), mint]);
      const ix = await client.ix.claimWinnings({ signer, market, collateralMint: mint });
      return client.sendIxs([computeBudgetIx(CU.HEAVY), ...pre, ix]);
    },

    async claimLpResiduals(market: PublicKey) {
      const signer = client.walletPubkey();
      const pre = await ataPreIxs([client.yesMint(market), client.noMint(market)]);
      const ix = await client.ix.claimLpResiduals({ signer, market });
      // Residual accrual + dual mint-to is compute-heavy — matches the app's
      // original 1.4M budget; 400k can trip "Program failed to complete".
      return client.sendIxs([computeBudgetIx(CU.HEAVY), ...pre, ix]);
    },

    async resolveMarket(market: PublicKey, side: Side) {
      const signer = client.walletPubkey();
      const ix = await client.ix.resolveMarket({ signer, market, side });
      return client.sendIxs([computeBudgetIx(CU.DEFAULT), ix]);
    },

    async accrue(market: PublicKey) {
      const ix = await client.ix.accrue({ market });
      return client.sendIxs([computeBudgetIx(CU.DEFAULT), ix]);
    },

    // ---- binary commitment vault ----
    async createVault(input: CreateVaultInput) {
      const authority = client.walletPubkey();
      const vaultId = randomU48();
      const ix = await client.ix.initializeVault({
        authority,
        vaultId,
        name: input.name,
        commitDurationSecs: input.commitDurationSecs,
        marketDurationSecs: input.marketDurationSecs,
        minTotal: usdc(input.minTotalUsdc),
      });
      const signature = await client.sendIxs([computeBudgetIx(CU.DEFAULT), ix]);
      return { vaultId, vaultPda: client.vaultPda(vaultId).toBase58(), signature };
    },

    async vaultCommit(vault: PublicKey, side: Side, amountUsdc: number) {
      const signer = client.walletPubkey();
      const pre = await ataPreIxs([client.collateralMint]);
      const ix = await client.ix.vaultCommit({ signer, vault, side, amount: usdc(amountUsdc) });
      return client.sendIxs([computeBudgetIx(CU.DEFAULT), ...pre, ix]);
    },

    async launchVaultMarket(vault: PublicKey) {
      const payer = client.walletPubkey();
      const marketId = randomU48();
      const ix = await client.ix.launchVaultMarket({ payer, vault, marketId });
      const signature = await client.sendIxs([computeBudgetIx(CU.HEAVY), ix]);
      return { marketId, marketPda: client.marketPda(marketId).toBase58(), signature };
    },

    async claimCommitter(vault: PublicKey, market: PublicKey) {
      const signer = client.walletPubkey();
      const ix = await client.ix.claimCommitter({ signer, vault, market });
      return client.sendIxs([computeBudgetIx(CU.DEFAULT), ix]);
    },

    async refundCommit(vault: PublicKey) {
      const signer = client.walletPubkey();
      const ix = await client.ix.refundCommit({ signer, vault });
      return client.sendIxs([computeBudgetIx(CU.DEFAULT), ix]);
    },

    ...makeBetSend(client, ataPreIxs),

    // ---- multi-outcome commitment vault ----
    async createVaultGroup(input: CreateVaultGroupInput) {
      if (input.legNames.length < 2 || input.legNames.length > 8) {
        throw new Error("createVaultGroup: legNames must contain 2 to 8 entries");
      }
      const authority = client.walletPubkey();
      const vaultId = randomU48();
      const ix = await client.ix.initializeVaultGroup({
        authority,
        vaultId,
        name: input.name,
        legNames: input.legNames,
        commitDurationSecs: input.commitDurationSecs,
        marketDurationSecs: input.marketDurationSecs,
        minTotal: usdc(input.minTotalUsdc),
      });
      const signature = await client.sendIxs([computeBudgetIx(CU.DEFAULT), ix]);
      return { vaultId, vaultPda: client.vaultGroupPda(vaultId).toBase58(), signature };
    },

    async vaultCommitGroup(vault: PublicKey, legIndex: number, amountUsdc: number) {
      const signer = client.walletPubkey();
      const pre = await ataPreIxs([client.collateralMint]);
      const ix = await client.ix.vaultCommitGroup({
        signer,
        vault,
        legIndex,
        amount: usdc(amountUsdc),
      });
      return client.sendIxs([computeBudgetIx(CU.DEFAULT), ...pre, ix]);
    },

    async launchVaultGroupMarket(vault: PublicKey) {
      const payer = client.walletPubkey();
      const groupId = randomU48();
      const ix = await client.ix.launchVaultGroupMarket({ payer, vault, groupId });
      const signature = await client.sendIxs([computeBudgetIx(CU.DEFAULT), ix]);
      return { groupId, groupPda: client.groupPda(groupId).toBase58(), signature };
    },

    async launchVaultGroupLeg(vault: PublicKey, group: PublicKey, legIndex: number) {
      const payer = client.walletPubkey();
      const marketId = randomU48();
      const ix = await client.ix.launchVaultGroupLeg({ payer, vault, group, legIndex, marketId });
      const signature = await client.sendIxs([computeBudgetIx(CU.HEAVY), ix]);
      return { marketId, marketPda: client.marketPda(marketId).toBase58(), signature };
    },

    async claimCommitterGroup(
      vault: PublicKey,
      group: PublicKey,
      market: PublicKey,
      legIndex: number,
    ) {
      const signer = client.walletPubkey();
      const ix = await client.ix.claimCommitterGroup({ signer, vault, group, market, legIndex });
      return client.sendIxs([computeBudgetIx(CU.DEFAULT), ix]);
    },

    async refundCommitGroup(vault: PublicKey) {
      const signer = client.walletPubkey();
      const ix = await client.ix.refundCommitGroup({ signer, vault });
      return client.sendIxs([computeBudgetIx(CU.DEFAULT), ix]);
    },
  };
}

/** `send.*` wrappers for Bet Vault v2. Amounts are human units of the vault's collateral. */
function makeBetSend(
  client: PmAmmClient,
  ataPreIxs: (mints: PublicKey[]) => Promise<TransactionInstruction[]>,
) {
  async function vaultCollateral(betVault: PublicKey) {
    const v = await client.fetchBetVault(betVault);
    if (!v) throw new Error("bet vault not found");
    const mint = v.collateralMint as PublicKey;
    return { v, mint, decimals: (await getMint(client.connection, mint)).decimals };
  }

  return {
    async createBetVault(input: CreateBetVaultInput) {
      const authority = client.walletPubkey();
      const vaultId = randomU48();
      const collateralMint = input.collateralMint ?? client.collateralMint;
      const decimals = (await getMint(client.connection, collateralMint)).decimals;
      const ix = await client.ix.initializeBetVault({
        authority,
        vaultId,
        name: input.name,
        commitDurationSecs: input.commitDurationSecs,
        marketDurationSecs: input.marketDurationSecs,
        minTotal: toRaw(input.minTotal, decimals),
        lpBps: input.lpBps ?? 5000,
        resolver: input.resolver,
        allowlist: input.allowlist,
        voidGraceSecs: input.voidGraceSecs,
        collateralMint,
      });
      const signature = await client.sendIxs([computeBudgetIx(CU.DEFAULT), ix]);
      return { vaultId, betVaultPda: client.betVaultPda(vaultId).toBase58(), signature };
    },

    async betCommit(betVault: PublicKey, side: Side, amount: number) {
      const signer = client.walletPubkey();
      const { mint, decimals } = await vaultCollateral(betVault);
      const pre = await ataPreIxs([mint]);
      const ix = await client.ix.betCommit({
        signer,
        betVault,
        side,
        amount: toRaw(amount, decimals),
        collateralMint: mint,
      });
      return client.sendIxs([computeBudgetIx(CU.DEFAULT), ...pre, ix]);
    },

    async launchBetVault(betVault: PublicKey) {
      const payer = client.walletPubkey();
      const { mint } = await vaultCollateral(betVault);
      const marketId = randomU48();
      const ix = await client.ix.launchBetVault({
        payer,
        betVault,
        marketId,
        collateralMint: mint,
      });
      const signature = await client.sendIxs([computeBudgetIx(CU.HEAVY), ix]);
      return { marketId, marketPda: client.marketPda(marketId).toBase58(), signature };
    },

    async resolveBetVault(betVault: PublicKey, side: Side) {
      const { v } = await vaultCollateral(betVault);
      const resolver = client.walletPubkey();
      const ix = await client.ix.resolveBetVault({ resolver, betVault, market: v.market, side });
      return client.sendIxs([computeBudgetIx(CU.DEFAULT), ix]);
    },

    async settleBetVault(betVault: PublicKey) {
      const { v, mint } = await vaultCollateral(betVault);
      const signer = client.walletPubkey();
      const ix = await client.ix.settleBetVault({
        signer,
        betVault,
        market: v.market,
        collateralMint: mint,
      });
      return client.sendIxs([computeBudgetIx(CU.DEFAULT), ix]);
    },

    /** Fallback: no resolution after `voidGraceSecs` → refund every stake. */
    async voidBetVault(betVault: PublicKey) {
      const { v, mint } = await vaultCollateral(betVault);
      const signer = client.walletPubkey();
      const ix = await client.ix.voidBetVault({
        signer,
        betVault,
        market: v.market,
        collateralMint: mint,
      });
      return client.sendIxs([computeBudgetIx(CU.DEFAULT), ix]);
    },

    async claimBet(betVault: PublicKey) {
      const signer = client.walletPubkey();
      const { mint } = await vaultCollateral(betVault);
      const pre = await ataPreIxs([mint]);
      const ix = await client.ix.claimBet({ signer, betVault, collateralMint: mint });
      return client.sendIxs([computeBudgetIx(CU.DEFAULT), ...pre, ix]);
    },

    async refundBet(betVault: PublicKey) {
      const signer = client.walletPubkey();
      const { mint } = await vaultCollateral(betVault);
      const pre = await ataPreIxs([mint]);
      const ix = await client.ix.refundBet({ signer, betVault, collateralMint: mint });
      return client.sendIxs([computeBudgetIx(CU.DEFAULT), ...pre, ix]);
    },
  };
}
