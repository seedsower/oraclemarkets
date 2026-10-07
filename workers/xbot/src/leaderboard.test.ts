import { test } from "node:test";
import assert from "node:assert/strict";
import type { ParsedTransactionWithMeta } from "@solana/web3.js";
import { aggregate, rankRows, stakeValue, type LeaderRow } from "./leaderboard";
import { toRecord } from "./trades-index";

const PROGRAM = "GV1FMGHRYBjQLaghE5fnGuYCuCcpdt3GD5xEX3TwN16y";
const USDC = "3WQ8hCqTNwjrh8WzE2XyoZoUrd1miPcwWfMkmFPUMEWZ";
const BOT = "Bot1111111111111111111111111111111111111111";
const ctx = { programId: PROGRAM, collateral: USDC, bot: BOT };

/** A parsed swap: `wallet` pays 5 USDC (fee by the bot) and gets 9.6 YES. */
function swapTx(wallet: string, signers: string[]): ParsedTransactionWithMeta {
  const bal = (accountIndex: number, owner: string, mint: string, amount: number) => ({
    accountIndex,
    owner,
    mint,
    uiTokenAmount: { amount: String(amount) },
  });
  return {
    blockTime: 1000,
    transaction: {
      message: {
        accountKeys: signers.map((s) => ({ pubkey: { toBase58: () => s }, signer: true })),
      },
    },
    meta: {
      err: null,
      logMessages: [
        `Program ${PROGRAM} invoke [1]`,
        "Program log: Instruction: Swap",
        `Program ${PROGRAM} success`,
      ],
      preTokenBalances: [
        bal(1, wallet, USDC, 50_000_000),
        bal(2, wallet, "YESMINT", 0),
        bal(3, "MarketPda", USDC, 100),
      ],
      postTokenBalances: [
        bal(1, wallet, USDC, 45_000_000),
        bal(2, wallet, "YESMINT", 9_600_000),
        bal(3, "MarketPda", USDC, 5_000_100),
      ],
    },
  } as unknown as ParsedTransactionWithMeta;
}

test("toRecord: the trader is the signer that isn't the bot; USDC and share deltas", () => {
  const r = toRecord("sig", swapTx("UserA", [BOT, "UserA"]), ctx);
  assert.equal(r?.wallet, "UserA");
  assert.equal(r?.ix, "Swap");
  assert.equal(r?.usdc, -5_000_000);
  assert.deepEqual(r?.tokens, { YESMINT: 9_600_000 });
  assert.equal(r?.venue, "MarketPda");
  assert.equal(toRecord("sig", swapTx("UserA", [BOT]), ctx), null, "bot-only txs are not trades");
  const seeding = swapTx("UserA", ["UserA"]);
  seeding.meta!.logMessages!.splice(1, 0, "Program log: Instruction: DepositLiquidity");
  assert.equal(toRecord("sig", seeding, ctx), null, "liquidity + seeding swap = market making");
});

test("aggregate: buys, sells and stakes fold into cash, shares, volume, trades", () => {
  const rec = (
    ix: string,
    usdc: number,
    tokens: Record<string, number>,
    venue: string | null = null,
  ) => ({
    sig: Math.random().toString(),
    wallet: "W",
    t: 1,
    ix,
    usdc,
    tokens,
    venue,
  });
  const a = aggregate([
    rec("Swap", -5_000_000, { Y: 9_600_000 }),
    rec("Swap", 2_000_000, { Y: -4_000_000 }),
    rec("BetCommit", -3_000_000, {}, "Vault1"),
    rec("ClaimWinnings", 5_600_000, { Y: -5_600_000 }),
  ]).get("W")!;
  assert.equal(a.usdc, -400_000);
  assert.equal(a.tokens.get("Y"), 0, "claimed shares are gone; the claim was neutral");
  assert.equal(a.volume, 10_000_000);
  assert.equal(a.trades, 3);
  assert.equal(a.staked.get("Vault1"), 3_000_000);
});

test("stakeValue + rankRows", () => {
  const settled = {
    settled: true,
    winningSide: 1,
    payoutPool: 3_000_000,
    yesTotal: 2_000_000,
    noTotal: 1_000_000,
  };
  assert.equal(stakeValue(settled, 2_000_000, 0), 3_000_000);
  assert.equal(stakeValue(settled, 0, 1_000_000), 0);
  assert.equal(stakeValue({ settled: false }, 2_000_000, 0), 2_000_000);
  const r = (wallet: string, pnl: number, volume: number) => ({ wallet, pnl, volume }) as LeaderRow;
  assert.deepEqual(
    rankRows([r("a", 1, 5), r("b", 3, 0), r("c", 1, 9)]).map((x) => x.wallet),
    ["b", "c", "a"],
  );
});
