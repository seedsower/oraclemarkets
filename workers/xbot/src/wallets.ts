import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { Keypair } from "@solana/web3.js";
import type IORedis from "ioredis";

/**
 * Custodial wallets for trading from X (devnet): one Solana keypair per X
 * user id. The secret key is encrypted with AES-256-GCM under a master key
 * that only lives in Railway (`XBOT_WALLET_MASTER_KEY`), bound to the user id
 * as associated data, so a ciphertext can't be moved to another user.
 *
 *   xwallets   hash: X user id → JSON WalletRecord
 *
 * Secret keys are never logged and never leave this module except as a
 * Keypair for signing (and, for the owner, the web export).
 */
export interface WalletRecord {
  pubkey: string;
  /** "v1.<iv>.<tag>.<ciphertext>" (base64). */
  secret: string;
  handle: string;
  createdAt: number;
}

const KEY = "xwallets";
const aad = (userId: string) => Buffer.from(`xwallet:v1:${userId}`);

/** XBOT_WALLET_MASTER_KEY: base64 of exactly 32 random bytes. */
export function parseMasterKey(raw: string): Buffer {
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("XBOT_WALLET_MASTER_KEY must be base64 of 32 bytes");
  return key;
}

export function encryptSecret(master: Buffer, userId: string, secret: Uint8Array): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", master, iv);
  c.setAAD(aad(userId));
  const ct = Buffer.concat([c.update(secret), c.final()]);
  return ["v1", iv, c.getAuthTag(), ct]
    .map((p) => (typeof p === "string" ? p : p.toString("base64")))
    .join(".");
}

export function decryptSecret(master: Buffer, userId: string, blob: string): Uint8Array {
  const [v, iv, tag, ct] = blob.split(".");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("bad wallet ciphertext");
  const d = createDecipheriv("aes-256-gcm", master, Buffer.from(iv, "base64"));
  d.setAAD(aad(userId));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return new Uint8Array(Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]));
}

export class Wallets {
  constructor(
    private readonly redis: IORedis,
    private readonly master: Buffer,
  ) {}

  async record(userId: string): Promise<WalletRecord | null> {
    const raw = await this.redis.hget(KEY, userId);
    return raw ? (JSON.parse(raw) as WalletRecord) : null;
  }

  private open(userId: string, r: WalletRecord): Keypair {
    const kp = Keypair.fromSecretKey(decryptSecret(this.master, userId, r.secret));
    if (kp.publicKey.toBase58() !== r.pubkey) throw new Error("wallet key mismatch");
    return kp;
  }

  /** The user's wallet, or null if they don't have one yet. */
  async get(userId: string): Promise<Keypair | null> {
    const r = await this.record(userId);
    return r ? this.open(userId, r) : null;
  }

  /** The user's wallet, creating it on first use (`created` tells the caller to fund it). */
  async getOrCreate(userId: string, handle: string): Promise<{ kp: Keypair; created: boolean }> {
    const existing = await this.get(userId);
    if (existing) return { kp: existing, created: false };
    const kp = Keypair.generate();
    const rec: WalletRecord = {
      pubkey: kp.publicKey.toBase58(),
      secret: encryptSecret(this.master, userId, kp.secretKey),
      handle,
      createdAt: Date.now(),
    };
    // HSETNX: two mentions racing for a new user keep exactly one wallet.
    if (await this.redis.hsetnx(KEY, userId, JSON.stringify(rec))) return { kp, created: true };
    return { kp: (await this.get(userId))!, created: false };
  }
}
