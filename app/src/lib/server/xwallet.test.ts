import { test } from "node:test";
import assert from "node:assert/strict";
import { createCipheriv, randomBytes } from "node:crypto";
import { Keypair } from "@solana/web3.js";
import { base58, decryptSecret } from "./xwallet";
import { readSession, sign, verify } from "./x-auth";

const master = randomBytes(32);
process.env.XBOT_WALLET_MASTER_KEY = master.toString("base64");

/** Same format as workers/xbot/src/wallets.ts encryptSecret. */
function encrypt(userId: string, secret: Uint8Array): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", master, iv);
  c.setAAD(Buffer.from(`xwallet:v1:${userId}`));
  const ct = Buffer.concat([c.update(secret), c.final()]);
  return [
    "v1",
    iv.toString("base64"),
    c.getAuthTag().toString("base64"),
    ct.toString("base64"),
  ].join(".");
}

test("decrypts the bot's wallet format, only for the right user", () => {
  const kp = Keypair.generate();
  const blob = encrypt("42", kp.secretKey);
  assert.deepEqual(Buffer.from(decryptSecret("42", blob)), Buffer.from(kp.secretKey));
  assert.throws(() => decryptSecret("43", blob));
});

test("base58 matches Solana's encoding", () => {
  const kp = Keypair.generate();
  assert.equal(base58(kp.publicKey.toBytes()), kp.publicKey.toBase58());
  assert.equal(base58(new Uint8Array([0, 0, 1])), "112");
});

test("signed cookies: tamper-proof and expiring", () => {
  const v = sign({ uid: "42", handle: "me", iat: Math.floor(Date.now() / 1000) });
  assert.equal(readSession(v)?.handle, "me");
  const [body, mac] = v.split(".");
  const forged = Buffer.from(JSON.stringify({ uid: "1", handle: "x", iat: 9e9 })).toString(
    "base64url",
  );
  assert.equal(verify(`${forged}.${mac}`), null);
  assert.equal(verify(`${body}.AAAA`), null);
  assert.equal(readSession(sign({ uid: "42", handle: "me", iat: 1 })), null, "expired");
});
