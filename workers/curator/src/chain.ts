/**
 * The curator's signing SDK client. CURATOR_KEYPAIR (base64 of the 64-byte
 * secret key, or base64 of the solana-keygen JSON array) is a dedicated key:
 * it becomes `market.authority` of every curated market, i.e. their resolver
 * and creator-fee recipient. Keep its balance small. The curator never resolves.
 */
import { readFileSync } from "node:fs";
import { AnchorProvider } from "@anchor-lang/core";
import { Connection, Keypair, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import { PmAmmClient } from "@pm-amm/sdk";

export const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";

/** base64 secret (64 bytes or a JSON array), or CURATOR_KEYPAIR_FILE (local runs). */
export function loadKeypair(env: Record<string, string | undefined> = process.env): Keypair | null {
  if (env.CURATOR_KEYPAIR) {
    const raw = Buffer.from(env.CURATOR_KEYPAIR.trim(), "base64");
    const text = raw.toString("utf8").trim();
    const bytes = text.startsWith("[") ? Uint8Array.from(JSON.parse(text) as number[]) : raw;
    return Keypair.fromSecretKey(bytes);
  }
  if (env.CURATOR_KEYPAIR_FILE) {
    const path = env.CURATOR_KEYPAIR_FILE.replace(/^~/, env.HOME ?? "");
    return Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(readFileSync(path, "utf8")) as number[]),
    );
  }
  return null;
}

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

export interface ChainConfig {
  rpcUrl: string;
  programId: PublicKey;
  collateralMint: PublicKey;
  allowMainnet: boolean;
}

export function loadChainConfig(
  env: Record<string, string | undefined> = process.env,
): ChainConfig {
  return {
    rpcUrl: env.RPC_URL ?? "https://api.devnet.solana.com",
    programId: new PublicKey(env.PROGRAM_ID ?? "97ySR6vWkxCC1oPbB2ytRSmKos4mExanuTu2e9VmoXcX"),
    collateralMint: new PublicKey(env.USDC_MINT ?? "3WQ8hCqTNwjrh8WzE2XyoZoUrd1miPcwWfMkmFPUMEWZ"),
    allowMainnet: env.CURATOR_ALLOW_MAINNET === "true",
  };
}

/** Signing client; refuses mainnet (by genesis hash) unless CURATOR_ALLOW_MAINNET=true. */
export async function makeCuratorClient(cfg: ChainConfig, kp: Keypair): Promise<PmAmmClient> {
  const connection = new Connection(cfg.rpcUrl, "confirmed");
  if ((await connection.getGenesisHash()) === MAINNET_GENESIS && !cfg.allowMainnet)
    throw new Error("refusing to run on mainnet (set CURATOR_ALLOW_MAINNET=true)");
  const provider = new AnchorProvider(connection, keypairWallet(kp), { commitment: "confirmed" });
  return PmAmmClient.fromProvider(provider, cfg.programId, cfg.collateralMint);
}

/** SOL and collateral (human units) on the curator wallet. */
export async function balances(
  connection: Connection,
  owner: PublicKey,
  mint: PublicKey,
): Promise<{ sol: number; usdc: number }> {
  const [lamports, tokens] = await Promise.all([
    connection.getBalance(owner),
    connection.getParsedTokenAccountsByOwner(owner, { mint }),
  ]);
  const usdc = tokens.value.reduce((sum, a) => {
    const amt = (a.account.data as { parsed?: { info?: { tokenAmount?: { uiAmount?: number } } } })
      .parsed?.info?.tokenAmount?.uiAmount;
    return sum + (typeof amt === "number" ? amt : 0);
  }, 0);
  return { sol: lamports / 1e9, usdc };
}
