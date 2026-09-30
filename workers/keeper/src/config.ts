import { Keypair, PublicKey } from "@solana/web3.js";

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw === undefined || raw === "" ? NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function pubkey(name: string, fallback: string): PublicKey {
  return new PublicKey(process.env[name] || fallback);
}

/** Dedicated hot wallet for `accrue` — base64 of the 64-byte secret key. */
function accrueKeypair(): Keypair | null {
  if (process.env.KEEPER_ACCRUE_ENABLED !== "true") return null;
  const b64 = process.env.KEEPER_KEYPAIR;
  if (!b64) return null;
  const secret = Buffer.from(b64, "base64");
  if (secret.length !== 64)
    throw new Error("KEEPER_KEYPAIR must be base64 of a 64-byte secret key");
  return Keypair.fromSecretKey(secret);
}

export interface KeeperConfig {
  rpcUrl: string;
  redisUrl: string;
  programId: PublicKey;
  collateralMint: PublicKey;
  intervalMs: number;
  accrue: null | {
    keypair: Keypair;
    everyMs: number;
    priorityMicroLamports: number;
    minLamports: number;
  };
}

export function loadConfig(): KeeperConfig {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) throw new Error("REDIS_URL is required");
  const keypair = accrueKeypair();
  return {
    rpcUrl: process.env.KEEPER_RPC_URL || "https://api.devnet.solana.com",
    redisUrl,
    programId: pubkey("PROGRAM_ID", "GV1FMGHRYBjQLaghE5fnGuYCuCcpdt3GD5xEX3TwN16y"),
    // Only used to construct the SDK client; list reads don't depend on it.
    collateralMint: pubkey("USDC_MINT", "3WQ8hCqTNwjrh8WzE2XyoZoUrd1miPcwWfMkmFPUMEWZ"),
    intervalMs: num("KEEPER_INTERVAL_SECS", 20) * 1000,
    accrue: keypair && {
      keypair,
      everyMs: num("KEEPER_ACCRUE_EVERY_SECS", 3600) * 1000,
      priorityMicroLamports: Math.floor(num("KEEPER_PRIORITY_MICROLAMPORTS", 5000)),
      minLamports: Math.floor(num("KEEPER_MIN_SOL", 0.05) * 1e9),
    },
  };
}
