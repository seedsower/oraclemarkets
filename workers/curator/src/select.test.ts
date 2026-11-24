import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fromPrediction, type Question } from "./question";
import { compareSelected, loadConfig, score, selectTop, skipReason } from "./select";
import { fitsName, pickTitle, utf8Bytes } from "./title";
import { keywordScreen } from "./policy-keywords";

const NOW = new Date("2026-11-23T12:00:00Z");
const DAY = 86_400_000;
const cfg = loadConfig({});

function q(over: Partial<Question> = {}): Question {
  return {
    id: "q1",
    title: "Fed cuts rates in December?",
    text: "Will the Fed cut rates at its December 2026 meeting?",
    category: "Economics",
    status: "active",
    closeAt: new Date(NOW.getTime() + 20 * DAY),
    criteria: "Resolves YES if the FOMC lowers the target range.",
    url: "https://example/q1",
    outcomes: 1,
    p: 0.4,
    agentCount: 9,
    updatedAt: new Date(NOW.getTime() - 3_600_000),
    venue: false,
    trendingRank: null,
    ...over,
  };
}
const why = (over: Partial<Question>, opts = {}) => skipReason(q(over), cfg, { now: NOW, ...opts });

test("config defaults and overrides", () => {
  assert.deepEqual(
    [cfg.minDays, cfg.maxDays, cfg.minProb, cfg.maxProb, cfg.topN, cfg.categories.length],
    [3, 120, 0.05, 0.95, 10, 12],
  );
  const c = loadConfig({ CURATOR_CATEGORIES: "crypto, Sports,bogus", CURATOR_TOP_N: "3" });
  assert.deepEqual(c.categories, ["Sports", "Crypto"]);
  assert.equal(c.topN, 3);
});

test("an eligible question passes", () => assert.equal(why({}), null));

test("each filter gives a reason", () => {
  assert.match(why({ status: "resolved" })!, /status/);
  assert.match(why({ criteria: "" })!, /resolution criteria/);
  assert.match(why({ outcomes: 3 })!, /multiple choice/);
  assert.match(why({ closeAt: null })!, /close date/);
  assert.match(why({ closeAt: new Date(NOW.getTime() + 2 * DAY) })!, /< 3/);
  assert.match(why({ closeAt: new Date(NOW.getTime() + 121 * DAY) })!, /> 120/);
  assert.match(why({ p: null })!, /consensus/);
  assert.match(why({ agentCount: 0 })!, /consensus/);
  assert.match(why({ updatedAt: null })!, /timestamp/);
  assert.match(why({ updatedAt: new Date(NOW.getTime() - 96 * 3_600_000) })!, /old/);
  assert.match(why({ p: 0.04 })!, /outside/);
  assert.match(why({ p: 0.96 })!, /outside/);
  assert.match(why({ category: "Weather" })!, /not curated/);
  assert.match(why({ title: "x".repeat(65), text: "y".repeat(80) })!, /64 bytes/);
  assert.match(why({ title: "Will a riot break out?" })!, /keyword.*violence/);
});

test("boundaries: 3 and 120 days, 5% and 95%, a forecast dated in the future", () => {
  assert.equal(why({ closeAt: new Date(NOW.getTime() + 3 * DAY) }), null);
  assert.equal(why({ closeAt: new Date(NOW.getTime() + 120 * DAY) }), null);
  assert.equal(why({ p: 0.05 }), null);
  assert.equal(why({ p: 0.95 }), null);
  assert.equal(why({ updatedAt: new Date(NOW.getTime() + 13 * 3_600_000) }), null);
});

test("Claude verdicts: rejection, missing verdict when required", () => {
  const verdicts = new Map([["q1", { ok: false, reason: "about a private person" }]]);
  assert.match(why({}, { verdicts })!, /private person/);
  assert.match(why({}, { requireVerdict: true })!, /not checked/);
  assert.equal(
    why({}, { requireVerdict: true, verdicts: new Map([["q1", { ok: true, reason: "ok" }]]) }),
    null,
  );
});

test("64-byte names: ASCII and multibyte boundaries, never cut", () => {
  assert.equal(fitsName("a".repeat(64)), true);
  assert.equal(fitsName("a".repeat(65)), false);
  const euro = "€".repeat(21); // 3 bytes each → 63
  assert.equal(utf8Bytes(euro), 63);
  assert.equal(fitsName(euro + "a"), true);
  assert.equal(fitsName(euro + "é"), false); // 65 bytes; é is 2
  assert.equal(fitsName("🚀".repeat(16)), true); // 4 × 16 = 64
  assert.equal(fitsName("🚀".repeat(16) + "!"), false);
  assert.equal(fitsName("   "), false);
  assert.equal(pickTitle(["x".repeat(70), "  Short   one  "]), "Short one");
  assert.equal(pickTitle(["x".repeat(70)]), null);
  assert.equal(fitsName("Will Alli win the 2027 Oyo State…"), false);
  assert.equal(pickTitle(["Cut short...", "Full question?"]), "Full question?");
});

test("a vetted short title rescues a long one", () => {
  const long = { title: "x".repeat(70), text: "y".repeat(90) };
  const shortTitles = new Map([["q1", "Fed cuts in December?"]]);
  assert.equal(why(long, { shortTitles }), null);
  const sel = selectTop([q(long)], cfg, { now: NOW, shortTitles });
  assert.equal(sel.selected[0]!.title, "Fed cuts in December?");
});

test("score: each term and weight", () => {
  const w = cfg.weights;
  const base = q({
    p: 0.5,
    closeAt: new Date(NOW.getTime() + 60 * DAY),
    updatedAt: new Date(NOW.getTime() - 2 * DAY),
  });
  assert.ok(Math.abs(score(base, w, NOW) - 0.3) < 1e-9);
  assert.ok(Math.abs(score({ ...base, venue: true }, w, NOW) - 0.7) < 1e-9);
  assert.ok(Math.abs(score({ ...base, p: 0.9 }, w, NOW) - 0.06) < 1e-9);
  assert.ok(
    Math.abs(score({ ...base, closeAt: new Date(NOW.getTime() + 30 * DAY) }, w, NOW) - 0.5) < 1e-9,
  );
  assert.ok(Math.abs(score({ ...base, updatedAt: NOW }, w, NOW) - 0.4) < 1e-9);
});

test("ranking: trending first, then score, then sooner close, then id", () => {
  const mk = (id: string, o: Partial<Question>, s: number) => ({
    question: q({ id, ...o }),
    title: id,
    score: s,
  });
  const a = mk("a", { trendingRank: 3 }, 0.1);
  const b = mk("b", { trendingRank: 1 }, 0.1);
  const c = mk("c", {}, 0.9);
  const d = mk("d", { closeAt: new Date(NOW.getTime() + 10 * DAY) }, 0.5);
  const e = mk("e", { closeAt: new Date(NOW.getTime() + 5 * DAY) }, 0.5);
  const f = mk("f", { closeAt: new Date(NOW.getTime() + 5 * DAY) }, 0.5);
  assert.deepEqual(
    [f, e, d, c, a, b].sort(compareSelected).map((s) => s.title),
    ["b", "a", "c", "e", "f", "d"],
  );
});

test("top N per category; extras skipped; fewer than N is fine; duplicates ignored", () => {
  const econ = Array.from({ length: 12 }, (_, i) => q({ id: `e${i}`, p: 0.1 + i * 0.05 }));
  const sports = [q({ id: "s1", category: "Sports" }), q({ id: "s1", category: "Sports" })];
  const sel = selectTop([...econ, ...sports], cfg, { now: NOW });
  assert.equal(sel.byCategory.Economics!.length, 10);
  assert.equal(sel.byCategory.Sports!.length, 1);
  assert.equal(sel.byCategory.Crypto!.length, 0);
  assert.equal(sel.skipped.filter((s) => /below top 10/.test(s.reason)).length, 2);
  assert.equal(sel.selected.length, 11);
  // the most uncertain (p = 0.5) ranks first; the two most decided (p = 0.1, 0.15) fall out
  assert.equal(sel.byCategory.Economics![0]!.question.id, "e8"); // p = 0.5
});

test("keyword screen", () => {
  const t = (title: string) => keywordScreen({ title, text: "", criteria: "" });
  assert.match(t("Will the senator die before 2027?")!, /death/);
  assert.match(t("Will riots in Benin surge?")!, /violence/);
  assert.match(t("Houthis resume Red Sea attacks in 2026?")!, /violence/);
  assert.match(t("Will China invade Taiwan?")!, /violence/);
  assert.match(t("Will children under 13 be banned from social media?")!, /minors/);
  assert.equal(t("Will Bitcoin close above $120k?"), null);
  assert.equal(t("Will the deadline be extended?"), null);
});

test("get_prediction sample normalizes", () => {
  const raw = JSON.parse(readFileSync(join(__dirname, "__fixtures__/get-prediction.json"), "utf8"));
  const n = fromPrediction({ content: [{ type: "text", text: JSON.stringify(raw) }] }, 4)!;
  assert.equal(n.id, "ai-tools-successfully-recover-access-lost-forgotten");
  assert.equal(n.category, "Technology");
  assert.equal(n.closeAt!.toISOString(), "2027-12-31T00:00:00.000Z");
  assert.equal(n.p, 0.17);
  assert.equal(n.agentCount, 9);
  assert.equal(n.outcomes, 1);
  assert.equal(n.trendingRank, 4);
  assert.equal(n.venue, false);
  assert.ok(n.criteria.startsWith("This question resolves YES"));
  const multi = fromPrediction({
    structuredContent: { ...raw, consensus: { outcomes: [{}, {}] } },
  })!;
  assert.equal(multi.p, null);
  assert.equal(multi.outcomes, 2);
  assert.equal(
    fromPrediction({ structuredContent: { question: { id: "fb-polymarket-x" } } })!.venue,
    true,
  );
  assert.equal(fromPrediction({ content: [{ type: "text", text: "prose" }] }), null);
});
