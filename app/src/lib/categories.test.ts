import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { categoryMessage, isCategory, resolveCategory } from "./categories";
import { verifyWalletSignature } from "./server/categories";

/** A wallet-like Ed25519 key: base58 pubkey + signMessage → base64. */
function wallet() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const x = publicKey.export({ format: "jwk" }).x!;
  const pubkey = new PublicKey(Buffer.from(x, "base64url")).toBase58();
  const signMessage = (m: string) =>
    sign(null, Buffer.from(m, "utf8"), privateKey).toString("base64");
  return { pubkey, signMessage };
}

test("the 7 categories, nothing else", () => {
  for (const s of [
    "crypto",
    "sports",
    "politics",
    "science",
    "entertainment",
    "finance",
    "personal",
  ]) {
    assert.ok(isCategory(s), s);
  }
  assert.equal(isCategory("memes"), false);
  assert.equal(isCategory(undefined), false);
});

test("wallet signatures verify only for the exact message and signer", () => {
  const w = wallet();
  const other = wallet();
  const msg = categoryMessage("Acct111", "crypto", 1_790_000_000);
  const sig = w.signMessage(msg);
  assert.equal(verifyWalletSignature(msg, sig, w.pubkey), true);
  assert.equal(
    verifyWalletSignature(msg.replace("crypto", "sports"), sig, w.pubkey),
    false,
    "tampered",
  );
  assert.equal(verifyWalletSignature(msg, sig, other.pubkey), false, "wrong signer");
  assert.equal(verifyWalletSignature(msg, "not-base64!!", w.pubkey), false);
});

test("launched markets inherit their vault's category", () => {
  const map = { vaultA: "sports", groupDirect: "politics", junk: "memes" };
  const links = {
    marketToVault: new Map([["marketFromVault", "vaultA"]]),
    groupToVault: new Map<string, string>(),
  };
  assert.equal(resolveCategory("groupDirect", map, links), "politics");
  assert.equal(resolveCategory("marketFromVault", map, links), "sports");
  assert.equal(resolveCategory("junk", map, links), null, "unknown slugs ignored");
  assert.equal(resolveCategory("nothing", map, links), null);
});
