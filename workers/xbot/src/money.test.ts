import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Keypair } from "@solana/web3.js";
import { decryptSecret, encryptSecret, parseMasterKey } from "./wallets";
import { parseMoney, stakeInBet } from "./money-commands";
import { linkIds } from "./money";
import { priceOk } from "./custody";

test("wallet secrets: round trip, bound to the user, tamper-evident", () => {
  const master = randomBytes(32);
  const kp = Keypair.generate();
  const blob = encryptSecret(master, "123", kp.secretKey);
  assert.ok(!blob.includes(Buffer.from(kp.secretKey).toString("base64")));
  assert.deepEqual(Buffer.from(decryptSecret(master, "123", blob)), Buffer.from(kp.secretKey));
  assert.throws(() => decryptSecret(master, "456", blob), "another user's id can't open it");
  assert.throws(() => decryptSecret(randomBytes(32), "123", blob), "wrong master key");
  const parts = blob.split(".");
  parts[3] = Buffer.from("x".repeat(64)).toString("base64");
  assert.throws(() => decryptSecret(master, "123", parts.join(".")), "tampered ciphertext");
  assert.notEqual(encryptSecret(master, "123", kp.secretKey), blob, "fresh IV each time");
  assert.throws(() => parseMasterKey(randomBytes(16).toString("base64")));
});

test("money commands: buy / sell / stake / balance / withdraw", () => {
  assert.deepEqual(parseMoney("buy YES $5"), {
    kind: "trade",
    action: "buy",
    side: "yes",
    usd: 5,
    ref: null,
  });
  assert.deepEqual(parseMoney("buy $10 no #123456"), {
    kind: "trade",
    action: "buy",
    side: "no",
    usd: 10,
    ref: "123456",
  });
  assert.equal((parseMoney("Buy yes 2.50 usdc") as { usd: number }).usd, 2.5);
  assert.equal((parseMoney("sell YES") as { usd: number | null }).usd, null, "sell all");
  assert.equal((parseMoney("sell no $3") as { usd: number }).usd, 3);
  assert.equal(parseMoney("stake YES $10")?.kind, "trade");
  assert.deepEqual(parseMoney("balance"), { kind: "balance" });
  assert.deepEqual(parseMoney("withdraw $20 to 5jddEQQjHNwrjf6NBjAhCaxZ3ZS2mzaeS4i3E4jLqqsm"), {
    kind: "withdraw",
    usd: 20,
    to: "5jddEQQjHNwrjf6NBjAhCaxZ3ZS2mzaeS4i3E4jLqqsm",
  });
  assert.equal(
    (parseMoney("withdraw all to 5jddEQQjHNwrjf6NBjAhCaxZ3ZS2mzaeS4i3E4jLqqsm") as { usd: null })
      .usd,
    null,
  );
});

test("money commands: unclear ones ask instead of guessing; other text isn't money", () => {
  assert.equal(parseMoney("buy $5")?.kind, "money-help", "no side");
  assert.equal(parseMoney("buy yes no $5")?.kind, "money-help", "both sides");
  assert.equal(parseMoney("buy YES")?.kind, "money-help", "no amount");
  assert.equal(parseMoney("withdraw $5")?.kind, "money-help", "no address");
  assert.equal(parseMoney("odds sol"), null);
  assert.equal(parseMoney("will btc hit 100k"), null);
  assert.equal(parseMoney("bet? by Oct 20"), null);
});

test("stakeInBet: only a side next to a dollar amount", () => {
  assert.deepEqual(stakeInBet("@x @oraclexbot bet? by Oct 20, I'll take YES $10"), {
    side: "yes",
    usd: 10,
  });
  assert.deepEqual(stakeInBet("bet? by Oct 20 $15 on no"), { side: "no", usd: 15 });
  assert.equal(stakeInBet("bet? by Oct 20"), null);
  assert.equal(stakeInBet("bet? will SOL hit $300 by Oct 20"), null);
});

test("linkIds: market / bet / group links", () => {
  assert.deepEqual(
    linkIds([
      "https://oraclemarkets.app/market/34670044014448",
      "https://oraclemarkets.app/bet/123?buy=yes&amount=10",
      "https://example.com/x",
      "https://oraclemarkets.app/group/7",
    ]),
    [
      { type: "market", id: 34670044014448 },
      { type: "bet", id: 123 },
      { type: "group", id: 7 },
    ],
  );
});

test("priceOk: fee + 5% impact allowed, more refused", () => {
  assert.ok(priceOk("buy", 0.53, 0.5, 500)); // 6% worse, within 7%
  assert.ok(!priceOk("buy", 0.54, 0.5, 500)); // 8% worse
  assert.ok(priceOk("sell", 0.47, 0.5, 500));
  assert.ok(!priceOk("sell", 0.46, 0.5, 500));
});
