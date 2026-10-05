import { createDecipheriv } from "node:crypto";
import { redis } from "@/lib/redis";

/**
 * Read side of the X bot's custodial wallets (workers/xbot/src/wallets.ts —
 * keep the format in sync): hash `xwallets`, X user id → { pubkey, secret,
 * handle, createdAt }, secret = AES-256-GCM under XBOT_WALLET_MASTER_KEY with
 * the user id as associated data. The web only decrypts for the owner's
 * explicit "export private key".
 */
interface WalletRecord {
  pubkey: string;
  secret: string;
  handle: string;
  createdAt: number;
}

export async function walletRecord(userId: string): Promise<WalletRecord | null> {
  if (!redis) return null;
  const raw = await redis.hget("xwallets", userId);
  return raw ? (JSON.parse(raw) as WalletRecord) : null;
}

export function decryptSecret(userId: string, blob: string): Uint8Array {
  const master = Buffer.from(process.env.XBOT_WALLET_MASTER_KEY ?? "", "base64");
  if (master.length !== 32) throw new Error("XBOT_WALLET_MASTER_KEY not set");
  const [v, iv, tag, ct] = blob.split(".");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("bad wallet ciphertext");
  const d = createDecipheriv("aes-256-gcm", master, Buffer.from(iv, "base64"));
  d.setAAD(Buffer.from(`xwallet:v1:${userId}`));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return new Uint8Array(Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]));
}

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Base58 (the format Phantom / Solflare import a private key in). */
export function base58(bytes: Uint8Array): string {
  let n = BigInt("0x" + (Buffer.from(bytes).toString("hex") || "0"));
  let out = "";
  const base = BigInt(58);
  while (n > BigInt(0)) {
    out = ALPHABET[Number(n % base)] + out;
    n /= base;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = "1" + out;
  }
  return out;
}
