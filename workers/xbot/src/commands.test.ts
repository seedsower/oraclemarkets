import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCommand, parseDeadline, stripMentions } from "./commands";

const now = new Date("2026-10-01T12:00:00Z");

test("strips the leading mention chain and links", () => {
  assert.equal(stripMentions("@daotao23 @alice odds sol https://t.co/x"), "odds sol");
});

test("odds", () => {
  assert.deepEqual(parseCommand("@daotao23 odds 114529827734419", now), {
    kind: "odds",
    query: "114529827734419",
  });
  assert.deepEqual(parseCommand("@daotao23 ODDS fed cut december", now), {
    kind: "odds",
    query: "fed cut december",
  });
  assert.equal(parseCommand("@daotao23 odds", now), null);
});

test("markets / trending", () => {
  assert.deepEqual(parseCommand("@daotao23 markets", now), { kind: "markets" });
  assert.deepEqual(parseCommand("@daotao23 trending?", now), { kind: "markets" });
});

test("propose <question> by <date>", () => {
  const c = parseCommand("@daotao23 propose Will ETH flip BTC by market cap by Dec 31", now);
  assert.equal(c?.kind, "propose");
  if (c?.kind !== "propose") return;
  assert.equal(c.question, "Will ETH flip BTC by market cap");
  assert.equal(c.by, "Dec 31");
  assert.equal(c.deadline?.toISOString().slice(0, 10), "2026-12-31");
});

test("propose: a past month/day rolls to next year; junk dates stay null", () => {
  const c = parseCommand("@daotao23 propose Will SOL hit $500 by Jan 5", now);
  assert.equal(c?.kind === "propose" && c.deadline?.toISOString().slice(0, 10), "2027-01-05");
  assert.equal(parseDeadline("whenever", now), null);
  assert.equal(parseDeadline("2027", now), null);
  assert.equal(parseDeadline("2026-12-31", now)?.toISOString().slice(0, 10), "2026-12-31");
  assert.equal(parseDeadline("December 31, 2026", now)?.toISOString().slice(0, 10), "2026-12-31");
});

test("anything else → no reply", () => {
  for (const t of [
    "@daotao23 gm",
    "@daotao23 bet 10 YES on sol",
    "@daotao23 propose short by",
    "@daotao23 what are the odds?",
    "@daotao23",
    "",
  ]) {
    assert.equal(parseCommand(t, now), null, t);
  }
});
