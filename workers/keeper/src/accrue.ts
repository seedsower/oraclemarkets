import {
  ComputeBudgetProgram,
  PublicKey,
  Transaction,
  VersionedTransaction,
  type Connection,
  type Keypair,
} from "@solana/web3.js";
import { AnchorProvider } from "@anchor-lang/core";
import { CU, PmAmmClient, type MarketView } from "@pm-amm/sdk";
import type { KeeperConfig } from "./config";
import { log, errMsg } from "./log";
import { withBackoff } from "./rpc";

type AccrueConfig = NonNullable<KeeperConfig["accrue"]>;

/** Minimal Anchor wallet over a local keypair (legacy + versioned txs). */
function keypairWallet(kp: Keypair) {
  const sign = <T extends Transaction | VersionedTransaction>(tx: T): T => {
    if (tx instanceof VersionedTransaction) tx.sign([kp]);
    else tx.partialSign(kp);
    return tx;
  };
  return {
    publicKey: kp.publicKey,
    payer: kp,
    signTransaction: async <T extends Transaction | VersionedTransaction>(tx: T) => sign(tx),
    signAllTransactions: async <T extends Transaction | VersionedTransaction>(txs: T[]) =>
      txs.map(sign),
  };
}

export function makeAccrueClient(connection: Connection, cfg: KeeperConfig): PmAmmClient | null {
  if (!cfg.accrue) return null;
  const provider = new AnchorProvider(connection, keypairWallet(cfg.accrue.keypair), {
    commitment: "confirmed",
  });
  return PmAmmClient.fromProvider(provider, cfg.programId, cfg.collateralMint);
}

/** Markets where `accrue` does useful work: trading, not expired, with LPs. */
function accruable(m: MarketView, now: number): boolean {
  return !m.resolved && now < m.endTs && m.totalLpShares > 0;
}

/**
 * Permissionless `accrue` on every active LP'd market, paid by a dedicated hot
 * wallet with no authority over anything. Stops entirely below the SOL floor.
 */
export async function accrueAll(
  client: PmAmmClient,
  cfg: AccrueConfig,
  markets: MarketView[],
  now: number,
): Promise<void> {
  const payer = cfg.keypair.publicKey;
  const targets = markets.filter((m) => accruable(m, now));
  let sent = 0;
  for (const m of targets) {
    const balance = await withBackoff("getBalance", () => client.connection.getBalance(payer));
    if (balance < cfg.minLamports) {
      log.warn("accrue paused: keeper wallet below KEEPER_MIN_SOL", {
        wallet: payer.toBase58(),
        lamports: balance,
      });
      break;
    }
    try {
      const ix = await client.ix.accrue({ market: new PublicKey(m.publicKey) });
      const sig = await withBackoff("accrue", () =>
        client.sendIxs([
          ComputeBudgetProgram.setComputeUnitLimit({ units: CU.DEFAULT }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: cfg.priorityMicroLamports }),
          ix,
        ]),
      );
      sent++;
      log.info("accrued", { market: m.publicKey, marketId: m.marketId, sig });
    } catch (e) {
      log.warn("accrue failed", { market: m.publicKey, error: errMsg(e) });
    }
  }
  log.info("accrue pass done", { candidates: targets.length, sent });
}
