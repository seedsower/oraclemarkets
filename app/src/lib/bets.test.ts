import { test } from "node:test";
import assert from "node:assert/strict";
import { betPhase, type BetVaultView } from "@pm-amm/sdk";
import { betStakePath, previewClaim } from "./bets";

const now = 1_790_000_000;
const base: BetVaultView = {
  publicKey: "pk",
  vaultId: 7,
  authority: "bot",
  resolver: "admin",
  collateralMint: "usdc",
  name: "Will it ship?",
  commitEndTs: now + 3600,
  marketEndTs: now + 86_400 * 10,
  yesTotal: 30_000_000,
  noTotal: 10_000_000,
  total: 40_000_000,
  commitCount: 4,
  minTotal: 2_000_000,
  lpBps: 5000,
  launched: false,
  priceBps: 0,
  market: "",
  winningSide: 0,
  settled: false,
  refunding: false,
  voided: false,
  voidGraceSecs: 7 * 86_400,
  payoutPool: 0,
  impliedYes: 0.75,
};

test("stake links reuse the buy-intent query", () => {
  assert.equal(betStakePath(7, "yes"), "/bet/7?buy=yes&amount=10");
  assert.equal(betStakePath("7", "no", 25), "/bet/7?buy=no&amount=25");
});

test("betPhase walks the on-chain lifecycle", () => {
  assert.equal(betPhase(base, now), "staking");
  const closed = now + 3600;
  assert.equal(betPhase(base, closed), "launch-ready");
  assert.equal(
    betPhase({ ...base, noTotal: 0, total: 30_000_000 }, closed),
    "refundable",
    "one-sided",
  );
  assert.equal(
    betPhase({ ...base, total: 1_000_000, yesTotal: 500_000, noTotal: 500_000 }, closed),
    "refundable",
    "below min",
  );
  const live = { ...base, launched: true, market: "m" };
  assert.equal(betPhase(live, closed), "live");
  assert.equal(betPhase(live, live.marketEndTs), "awaiting-resolution");
  assert.equal(betPhase(live, live.marketEndTs + live.voidGraceSecs), "voidable");
  assert.equal(betPhase(live, live.marketEndTs, true), "settle-ready");
  assert.equal(betPhase({ ...live, settled: true }, live.marketEndTs), "claimable");
  assert.equal(betPhase({ ...live, voided: true }, live.marketEndTs), "voided");
});

test("previewClaim: winners split the pool, losers get 0, void refunds", () => {
  const settled = {
    ...base,
    launched: true,
    settled: true,
    winningSide: 2,
    payoutPool: 39_000_000,
  };
  // NO won: the 10 USDC of NO stakes split a 39 USDC pool.
  assert.deepEqual(previewClaim(settled, { yes: 0, no: 5_000_000 }), {
    stake: 5_000_000,
    payout: 19_500_000,
    outcome: "won",
  });
  assert.equal(previewClaim(settled, { yes: 10_000_000, no: 0 }).outcome, "lost");
  const voided = { ...base, launched: true, voided: true, payoutPool: 40_000_000 };
  assert.deepEqual(previewClaim(voided, { yes: 10_000_000, no: 0 }), {
    stake: 10_000_000,
    payout: 10_000_000,
    outcome: "refund",
  });
});
