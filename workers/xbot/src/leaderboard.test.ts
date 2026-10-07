import { test } from "node:test";
import assert from "node:assert/strict";
import { rankRows, stakeValue, type LeaderRow } from "./leaderboard";

test("stakeValue: face value until settled, then the payout; losers 0", () => {
  const open = { settled: false, voided: false };
  assert.equal(stakeValue(open, 2_000_000, 0), 2_000_000);
  const settled = {
    settled: true,
    winningSide: 1,
    payoutPool: 3_000_000,
    yesTotal: 2_000_000,
    noTotal: 1_000_000,
  };
  assert.equal(stakeValue(settled, 2_000_000, 0), 3_000_000, "the YES side takes the pot");
  assert.equal(stakeValue(settled, 0, 1_000_000), 0);
  const voided = { voided: true, payoutPool: 3_000_000, yesTotal: 2_000_000, noTotal: 1_000_000 };
  assert.equal(stakeValue(voided, 0, 1_000_000), 1_000_000, "refunded pro-rata");
});

test("rankRows: P&L first, volume breaks ties", () => {
  const r = (handle: string, pnl: number, volume: number) => ({ handle, pnl, volume }) as LeaderRow;
  assert.deepEqual(
    rankRows([r("a", 1, 5), r("b", 3, 0), r("c", 1, 9)]).map((x) => x.handle),
    ["b", "c", "a"],
  );
});
