import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import type { MarketView } from "@pm-amm/sdk";
import { PROGRAM_ID, USDC_MINT } from "@/lib/constants";
import {
  ACTIONS_CONFIG,
  assertAllowedPrograms,
  invokedPrograms,
  parseAccount,
  parseAmount,
  parseSide,
} from "./common";
import { buyMessage, disabledReason, marketActionGet } from "./market-action";

const now = 1_800_000_000;
const market: MarketView = {
  publicKey: Keypair.generate().publicKey.toBase58(),
  marketId: 42,
  authority: Keypair.generate().publicKey.toBase58(),
  collateralMint: USDC_MINT.toBase58(),
  name: "Will it ship?",
  startTs: now - 1000,
  endTs: now + 3 * 86_400 + 60,
  lZero: 1,
  reserveYes: 100,
  reserveNo: 120,
  totalLpShares: 1,
  resolved: false,
  winningSide: 0,
  price: 0.34,
  lEff: 500,
  cumYesPerShare: 0,
  cumNoPerShare: 0,
  group: "",
  initialPriceBps: 0,
};
const open = { featuredOnly: false, featured: true };

test("GET: title, icon, label and the six linked actions", () => {
  const r = marketActionGet(market, {
    base: "/api/actions/market/42",
    iconUrl: "https://x/i.png",
    disabled: null,
  });
  assert.equal(r.title, "Will it ship?");
  assert.equal(r.icon, "https://x/i.png");
  assert.equal(r.label, "Predict");
  assert.equal(r.disabled, undefined);
  assert.match(r.description, /YES 34¢ · NO 66¢/);
  assert.match(r.description, /Resolved by the market creator \(/);
  const actions = r.links!.actions;
  assert.deepEqual(
    actions.map((a) => a.label),
    ["YES $5", "YES $25", "NO $5", "NO $25", "Buy YES", "Buy NO"],
  );
  assert.equal(actions[0]!.href, "/api/actions/market/42?side=yes&amount=5");
  assert.ok(actions.every((a) => a.type === "transaction"));
  const param = actions[4]!.parameters![0]!;
  assert.equal(actions[4]!.href, "/api/actions/market/42?side=yes&amount={amount}");
  assert.equal(param.name, "amount");
  assert.equal(param.min, 1);
  assert.equal(param.max, ACTIONS_CONFIG.maxUsdc);
});

test("GET: disabled markets carry disabled + error.message", () => {
  const r = marketActionGet(market, { base: "/b", iconUrl: "/i", disabled: "closed" });
  assert.equal(r.disabled, true);
  assert.deepEqual(r.error, { message: "closed" });
});

test("disabledReason covers resolved / expired / illiquid / non-USDC / featured-only", () => {
  assert.equal(disabledReason(market, now, open), null);
  assert.match(
    disabledReason({ ...market, resolved: true, winningSide: 1 }, now, open)!,
    /YES won/,
  );
  assert.match(disabledReason(market, market.endTs, open)!, /closed/);
  assert.match(disabledReason({ ...market, lEff: 0 }, now, open)!, /liquidity/);
  const sol = { ...market, collateralMint: "So11111111111111111111111111111111111111112" };
  assert.match(disabledReason(sol, now, open)!, /USDC markets only/);
  assert.match(
    disabledReason(market, now, { featuredOnly: true, featured: false })!,
    /isn't available/,
  );
});

test("POST validation: account must be an on-curve base58 key", () => {
  const wallet = Keypair.generate().publicKey;
  assert.ok(parseAccount(wallet.toBase58())?.equals(wallet));
  const pda = PublicKey.findProgramAddressSync([Buffer.from("x")], PROGRAM_ID)[0];
  assert.equal(parseAccount(pda.toBase58()), null);
  for (const bad of [undefined, 42, "", "not-a-key", "0".repeat(44)]) {
    assert.equal(parseAccount(bad), null);
  }
});

test("POST validation: side and amount", () => {
  assert.equal(parseSide("yes"), "yes");
  assert.equal(parseSide("no"), "no");
  assert.equal(parseSide("YES"), null);
  assert.equal(parseSide(null), null);
  assert.equal(parseAmount("5"), 5);
  assert.equal(parseAmount("12.5"), 12.5);
  assert.equal(parseAmount(String(ACTIONS_CONFIG.maxUsdc)), ACTIONS_CONFIG.maxUsdc);
  for (const bad of [
    null,
    "0",
    "0.5",
    String(ACTIONS_CONFIG.maxUsdc + 1),
    "1e3",
    "-5",
    "5.123",
    "abc",
  ]) {
    assert.equal(parseAmount(bad), null, `amount ${bad}`);
  }
});

function swapLikeTx(extra: TransactionInstruction[] = []): Transaction {
  const payer = Keypair.generate().publicKey;
  const tx = new Transaction({
    feePayer: payer,
    blockhash: "11111111111111111111111111111111",
    lastValidBlockHeight: 1,
  });
  const ata = getAssociatedTokenAddressSync(USDC_MINT, payer);
  tx.add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
    createAssociatedTokenAccountIdempotentInstruction(payer, ata, payer, USDC_MINT),
    new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [{ pubkey: payer, isSigner: true, isWritable: true }],
      data: Buffer.from([1]),
    }),
    ...extra,
  );
  return tx;
}

test("security: only ComputeBudget, Associated Token and pm-AMM may appear", () => {
  const ok = swapLikeTx();
  assert.doesNotThrow(() => assertAllowedPrograms(ok));
  const b64 = ok
    .serialize({ requireAllSignatures: false, verifySignatures: false })
    .toString("base64");
  assert.doesNotThrow(() => assertAllowedPrograms(b64));
  assert.equal(invokedPrograms(b64).length, 3);

  const payer = ok.feePayer!;
  const thief = Keypair.generate().publicKey;
  const transfer = SystemProgram.transfer({ fromPubkey: payer, toPubkey: thief, lamports: 1 });
  assert.throws(() => assertAllowedPrograms(swapLikeTx([transfer])), /refusing/);
  const memo = new TransactionInstruction({
    programId: new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"),
    keys: [],
    data: Buffer.from("hi"),
  });
  const memoTx = swapLikeTx([memo]);
  const memoB64 = memoTx
    .serialize({ requireAllSignatures: false, verifySignatures: false })
    .toString("base64");
  assert.throws(() => assertAllowedPrograms(memoB64), /refusing/);
});

test("security: a bare SPL token transfer is refused (its only use here would be draining the signer)", () => {
  const p = Keypair.generate().publicKey;
  const ix = createTransferInstruction(p, Keypair.generate().publicKey, p, 1);
  assert.throws(() => assertAllowedPrograms(swapLikeTx([ix])), /refusing/);
});

test("buyMessage", () => {
  assert.equal(buyMessage("yes", 14.71, 0.34), "Buying ~14.71 YES at ≈34¢. 2% fee included.");
  assert.equal(buyMessage("no", 250.4, 0.66), "Buying ~250 NO at ≈66¢. 2% fee included.");
});
