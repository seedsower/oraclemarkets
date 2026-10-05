import { test } from "node:test";
import assert from "node:assert/strict";
import { quoteReserves, quoteSwap, SWAP_FEE_BPS, type MarketView } from "@pm-amm/sdk";

// Real devnet snapshot (market 114529827734419, 2026-10-01): idle ~205k s since
// the last accrue. Simulating a 5 USDC YES buy on-chain returned 9,590,546 raw.
const now = 1_790_900_000;
const lastAccrualTs = now - 205_661;
const lZero = 832146.3941075662;
const endTs = lastAccrualTs + Math.round((584882900.2157876 / lZero) ** 2);
const m = {
  reserveYes: 228499162.586124,
  reserveNo: 238234518.34641606,
  lZero,
  endTs,
  lEff: lZero * Math.sqrt(endTs - now),
  lastAccrualTs,
} as MarketView;
const ON_CHAIN = 9_590_546;

test("quoteReserves pairs reserves with L_eff at the last accrual", () => {
  const { output } = quoteSwap(quoteReserves(m), "buy", "yes", 5_000_000, SWAP_FEE_BPS);
  const err = Math.abs(output - ON_CHAIN) / ON_CHAIN;
  assert.ok(err < 0.01, `quote ${output} vs on-chain ${ON_CHAIN} (${(err * 100).toFixed(2)}%)`);
});

test("regression: L_eff(now) with stale reserves overstates the output", () => {
  const stale = { reserveYes: m.reserveYes, reserveNo: m.reserveNo, lEff: m.lEff };
  const { output } = quoteSwap(stale, "buy", "yes", 5_000_000, SWAP_FEE_BPS);
  assert.ok(output > ON_CHAIN * 5, "the old pairing was ~11x off");
});

test("rows cached before lastAccrualTs existed fall back to lEff", () => {
  const old = { ...m, lastAccrualTs: undefined };
  assert.equal(quoteReserves(old).lEff, m.lEff);
});

test("sells follow the on-chain formula: ≤ 1 USDC per share, and a round trip loses money", () => {
  const r = quoteReserves(m);
  const shares = quoteSwap(r, "buy", "yes", 5_000_000, SWAP_FEE_BPS).output;
  for (const side of ["yes", "no"] as const) {
    const { output } = quoteSwap(r, "sell", side, shares, SWAP_FEE_BPS);
    assert.ok(output > 0 && output < shares, `${side}: ${output} for ${shares} shares`);
  }
  // Buy 5 USDC of YES then sell it straight back: you get back less than 5 (fees + curve).
  const back = quoteSwap(r, "sell", "yes", shares, SWAP_FEE_BPS).output;
  assert.ok(back < 5_000_000 && back > 4_000_000, `round trip returned ${back}`);
});

test("selling nothing returns nothing", () => {
  // (The old sell formula — buy math with sides swapped — over-quoted a real
  // devnet sell 4.8x: 4.65 vs 0.96 USDC paid, so every minOutput failed.)
  const { output } = quoteSwap(
    { reserveYes: 1, reserveNo: 1, lEff: 1 },
    "sell",
    "yes",
    0,
    SWAP_FEE_BPS,
  );
  assert.equal(output, 0);
});
