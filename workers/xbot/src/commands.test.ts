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
  assert.equal(parseDeadline("december", now)?.toISOString().slice(0, 10), "2026-12-31");
  assert.equal(parseDeadline("Feb 2027", now)?.toISOString().slice(0, 10), "2027-02-28");
  assert.equal(parseDeadline("2026-12-31", now)?.toISOString().slice(0, 10), "2026-12-31");
  assert.equal(parseDeadline("December 31, 2026", now)?.toISOString().slice(0, 10), "2026-12-31");
});

test("typos and synonyms of the commands", () => {
  assert.deepEqual(parseCommand("@daotao23 odd btc", now), { kind: "odds", query: "btc" });
  assert.deepEqual(parseCommand("@daotao23 price sol", now), { kind: "odds", query: "sol" });
  assert.deepEqual(parseCommand("@daotao23 trending", now), { kind: "markets" });
  assert.deepEqual(parseCommand("@daotao23 top", now), { kind: "markets" });
  assert.equal(parseCommand("@daotao23 suggest Will SOL hit $500 by Jan 5", now)?.kind, "propose");
});

test("plain questions and topics (the real posts that got no reply)", () => {
  assert.deepEqual(parseCommand("@daotao23 sol price today", now), {
    kind: "question",
    query: "sol price today",
    isWill: false,
  });
  assert.deepEqual(parseCommand("@daotao23 will sol flip btc in volume", now), {
    kind: "question",
    query: "will sol flip btc in volume",
    isWill: true,
  });
  assert.deepEqual(parseCommand("@daotao23 will btc reach 100k by december", now), {
    kind: "question",
    query: "will btc reach 100k by december",
    isWill: true,
  });
  assert.equal(parseCommand("@daotao23 what are the odds on sol?", now)?.kind, "question");
});

test("small talk and empty mentions → no reply", () => {
  for (const t of [
    "@daotao23 gm",
    "@daotao23 gm ser",
    "@daotao23 thanks!",
    "@daotao23 love this",
    "@daotao23 what are the odds?",
    "@daotao23 propose short by",
    "@daotao23",
    "",
  ]) {
    assert.equal(parseCommand(t, now), null, t);
  }
});

test("bet: reply form, inline question, and missing pieces", () => {
  const r = parseCommand("@takeguy @daotao23 bet? by Oct 20", now);
  assert.equal(r?.kind, "bet");
  if (r?.kind !== "bet") return;
  assert.equal(r.question, null, "question comes from the parent post");
  assert.equal(r.by, "Oct 20");
  assert.equal(r.deadline?.toISOString().slice(0, 10), "2026-10-20");

  const inline = parseCommand("@daotao23 bet Will SOL flip ETH by Oct 25", now);
  assert.equal(inline?.kind === "bet" && inline.question, "Will SOL flip ETH");

  const bare = parseCommand("@daotao23 bet?", now);
  assert.deepEqual(bare, {
    kind: "bet",
    question: null,
    by: null,
    deadline: null,
    windowSecs: null,
    category: null,
  });
  const vague = parseCommand("@daotao23 bet on it", now);
  assert.equal(vague?.kind === "bet" && vague.question, null);
});

test("bet: optional staking window at the end", () => {
  const w = (t: string) => {
    const c = parseCommand(t, now);
    return c?.kind === "bet" ? c : null;
  };
  assert.equal(w("@daotao23 bet? by Oct 20 in 1h")?.windowSecs, 3600);
  assert.equal(w("@daotao23 bet? by Oct 20 in 30m")?.windowSecs, 1800);
  assert.equal(w("@daotao23 bet? by Oct 20 in 2 hours")?.windowSecs, 7200);
  assert.equal(w("@daotao23 bet? by Oct 20 in 1d")?.windowSecs, 86_400);
  assert.equal(
    w("@daotao23 bet? by Oct 20 in 1h")?.deadline?.toISOString().slice(0, 10),
    "2026-10-20",
  );
  assert.equal(w("@daotao23 bet? by Oct 20")?.windowSecs, null, "default window");
  // "in the top 3" is part of the question, not a window.
  const q = w("@daotao23 bet Will SOL be in the top 3 by Oct 20");
  assert.equal(q?.question, "Will SOL be in the top 3");
  assert.equal(q?.windowSecs, null);
});

test("bet: category hashtag (#crypto) is parsed and removed", () => {
  const c = parseCommand("@daotao23 bet? by Oct 20 in 1h #Crypto", now);
  assert.equal(c?.kind === "bet" && c.category, "crypto");
  assert.equal(c?.kind === "bet" && c.windowSecs, 3600);
  assert.equal(c?.kind === "bet" && c.deadline?.toISOString().slice(0, 10), "2026-10-20");
  const unknown = parseCommand("@daotao23 bet? by Oct 20 #memes", now);
  assert.equal(unknown?.kind === "bet" && unknown.category, null);
});
