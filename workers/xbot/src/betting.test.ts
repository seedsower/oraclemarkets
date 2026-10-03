import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey } from "@solana/web3.js";
import { parseCommand } from "./commands";
import { betOpenedReply, cleanTake, clipBytes, planBet } from "./betting";
import type { BetsConfig } from "./config";
import type { Mention } from "./xapi";

const nowDate = new Date("2026-10-02T12:00:00Z");
const now = Math.floor(nowDate.getTime() / 1000);
const cfg: BetsConfig = {
  wallet: Keypair.generate(),
  resolver: new PublicKey("11111111111111111111111111111111"),
  rpcUrl: "x",
  programId: new PublicKey("11111111111111111111111111111111"),
  collateralMint: new PublicKey("11111111111111111111111111111111"),
  stakeWindowSecs: 24 * 3600, // tests pin a 24h default; production default is 1h
  minTotalUsdc: 2,
  lpBps: 5000,
  perDay: 10,
  perUserPerDay: 2,
  minLamports: 0,
};
const take = {
  id: "111",
  text: "@someone SOL flips ETH by market cap this month, easy",
  username: "takeguy",
};
const mention = (text: string, parent: Mention["parent"] = take): Mention => ({
  id: "222",
  text,
  authorId: "9",
  username: "challenger",
  parent,
});
const bet = (text: string) => {
  const c = parseCommand(text, nowDate);
  assert.equal(c?.kind, "bet");
  return c as Extract<NonNullable<typeof c>, { kind: "bet" }>;
};

test("bet? by <date> under a take opens a bet on the take", () => {
  const p = planBet(bet("@takeguy @daotao23 bet? by Oct 20"), mention("x"), cfg, now);
  assert.equal(p.action, "open");
  if (p.action !== "open") return;
  assert.equal(p.question, "SOL flips ETH by market cap this month, easy");
  assert.equal(p.sourceId, "111");
  assert.equal(p.sourceUrl, "https://x.com/takeguy/status/111");
  assert.equal(p.deadline.toISOString(), "2026-10-20T23:59:59.000Z", "end of the day, UTC");
  assert.equal(p.marketDurationSecs, Math.floor(p.deadline.getTime() / 1000) - (now + 86_400));
});

test("inline question with no parent post", () => {
  const p = planBet(bet("@daotao23 bet Will SOL flip ETH by Oct 25"), mention("x", null), cfg, now);
  assert.equal(p.action === "open" && p.question, "Will SOL flip ETH");
  assert.equal(p.action === "open" && p.sourceId, "222");
});

test("missing take, missing deadline, out-of-range deadline → helpful replies", () => {
  const noTake = planBet(bet("@daotao23 bet? by Oct 20"), mention("x", null), cfg, now);
  assert.match(noTake.action === "reply" ? noTake.text : "", /under the take/);
  const noDate = planBet(bet("@daotao23 bet?"), mention("x"), cfg, now);
  assert.match(noDate.action === "reply" ? noDate.text : "", /Add a deadline/);
  const tooFar = planBet(bet("@daotao23 bet? by Dec 31"), mention("x"), cfg, now);
  assert.match(
    tooFar.action === "reply" ? tooFar.text : "",
    /Pick a deadline between Oct 3 and Nov 2/,
  );
  const tooSoon = planBet(bet("@daotao23 bet? by Oct 2"), mention("x"), cfg, now);
  assert.equal(tooSoon.action, "reply");
});

test("names are clipped to 64 BYTES without splitting characters", () => {
  const s = "🚀".repeat(30); // 4 bytes each
  const c = clipBytes(s);
  assert.ok(new TextEncoder().encode(c).length <= 64);
  assert.ok(c.endsWith("…"));
  assert.equal(clipBytes("short"), "short");
  assert.equal(cleanTake("@a @b  big take https://t.co/x  "), "big take");
});

test("opened reply fits X's 280 (links count as 23)", () => {
  const r = betOpenedReply(
    "x".repeat(300),
    123456789012345,
    new Date("2026-10-20T23:59:59Z"),
    "24h",
    "https://oraclemarkets.app",
  );
  const weighted = r.replace(/https?:\/\/\S+/g, "x".repeat(23)).length;
  assert.ok(weighted <= 280, `weighted ${weighted}`);
  assert.match(r, /YES: https:\/\/oraclemarkets\.app\/bet\/123456789012345\?buy=yes&amount=10/);
  assert.match(r, /Resolves Oct 20/);
});

test("staking window label", async () => {
  const { windowLabel } = await import("./betting");
  assert.equal(windowLabel(24 * 3600), "24h");
  assert.equal(windowLabel(72), "1m");
  assert.equal(windowLabel(1800), "30m");
});

test("per-bet window: used for staking and the deadline math; bounded 15m..7d", () => {
  const p = planBet(bet("@daotao23 bet? by Oct 20 in 1h"), mention("x"), cfg, now);
  assert.equal(p.action === "open" && p.windowSecs, 3600);
  assert.equal(
    p.action === "open" && p.marketDurationSecs,
    p.action === "open" && Math.floor(p.deadline.getTime() / 1000) - (now + 3600),
  );
  const tooShort = planBet(bet("@daotao23 bet? by Oct 20 in 5m"), mention("x"), cfg, now);
  assert.match(tooShort.action === "reply" ? tooShort.text : "", /15m to 7d/);
  const tooLong = planBet(bet("@daotao23 bet? by Oct 20 in 9d"), mention("x"), cfg, now);
  assert.equal(tooLong.action, "reply");
  const dflt = planBet(bet("@daotao23 bet? by Oct 20"), mention("x"), cfg, now);
  assert.equal(dflt.action === "open" && dflt.windowSecs, 24 * 3600);
});

test("category: from the reply's hashtag, else the take's; stripped from the question", () => {
  const tagged = { ...take, text: "SOL flips ETH this month #crypto #wagmi" };
  const p = planBet(bet("@daotao23 bet? by Oct 20"), mention("x", tagged), cfg, now);
  assert.equal(p.action === "open" && p.category, "crypto");
  assert.equal(p.action === "open" && p.question, "SOL flips ETH this month");
  const override = planBet(
    bet("@daotao23 bet? by Oct 20 #finance"),
    mention("x", tagged),
    cfg,
    now,
  );
  assert.equal(override.action === "open" && override.category, "finance");
  const none = planBet(bet("@daotao23 bet? by Oct 20"), mention("x"), cfg, now);
  assert.equal(none.action === "open" && none.category, null);
});
