import { AnchorProvider } from "@anchor-lang/core";
import { Connection, Transaction, VersionedTransaction, type Keypair } from "@solana/web3.js";
import { PmAmmClient } from "@pm-amm/sdk";
import type { BetsConfig } from "./config";

/** Minimal Anchor wallet over the bot's hot keypair (legacy + versioned txs). */
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

/** Signing SDK client for the bot wallet (opens + launches + settles bets; never resolves). */
export function makeBetClient(cfg: BetsConfig): PmAmmClient {
  const connection = new Connection(cfg.rpcUrl, "confirmed");
  const provider = new AnchorProvider(connection, keypairWallet(cfg.wallet), {
    commitment: "confirmed",
  });
  return PmAmmClient.fromProvider(provider, cfg.programId, cfg.collateralMint);
}
