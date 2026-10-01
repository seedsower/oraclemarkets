import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findMarket,
  marketsReply,
  notFoundReply,
  oddsReply,
  type GroupRow,
  type MarketRow,
} from "./replies";

const now = 1_790_900_000;
const site = "https://oraclemarkets.app";
const OP = "6NG87yZrQw6zH6Au8fHbYcD7Dken5smAzisLeXazpt8E";
const mk = (o: Partial<MarketRow>): MarketRow => ({
  publicKey: `pk${o.marketId}`,
  marketId: 1,
  authority: "someone",
  name: "Market",
  price: 0.5,
  endTs: now + 3 * 86_400 + 60,
  resolved: false,
  winningSide: 0,
  group: "",
  lZero: 1,
  ...o,
});
const markets = [
  mk({
    marketId: 11,
    name: "Will SOL close above $200 on Oct 4, 2026?",
    price: 0.52,
    authority: OP,
    lZero: 9,
  }),
  mk({
    marketId: 12,
    name: "Will the Fed cut rates in December 2026?",
    price: 0.47,
    authority: OP,
    lZero: 8,
  }),
  mk({ marketId: 13, name: "Will SOL trade above $300 by Nov 30, 2026?", price: 0.26, lZero: 5 }),
  mk({ marketId: 14, name: "Best performer in Q4 2026 - SOL", group: "g1", price: 0.34 }),
  mk({ marketId: 15, name: "Old SOL market", resolved: true, winningSide: 1 }),
];
const groups: GroupRow[] = [
  {
    groupId: 77,
    authority: OP,
    name: "Best performer in Q4 2026",
    endTs: now + 91 * 86_400,
    resolved: false,
    legs: [
      markets[3]!,
      mk({ marketId: 16, name: "Best performer in Q4 2026 - BTC", price: 0.33, group: "g1" }),
    ],
  },
];
const featured = (a: string) => a === OP;

test("find by numeric id (market or group)", () => {
  assert.equal(findMarket("12", markets, groups, featured, now)?.kind, "market");
  const g = findMarket("77", markets, groups, featured, now);
  assert.equal(g?.kind === "group" && g.g.groupId, 77);
  assert.equal(findMarket("999", markets, groups, featured, now), null);
});

test("find by words: best match wins, legs never match on their own", () => {
  const f = findMarket("fed cut december", markets, groups, featured, now);
  assert.equal(f?.kind === "market" && f.m.marketId, 12);
  const sol = findMarket("SOL $200", markets, groups, featured, now);
  assert.equal(sol?.kind === "market" && sol.m.marketId, 11);
  const g = findMarket("best performer q4", markets, groups, featured, now);
  assert.equal(g?.kind, "group");
  assert.equal(findMarket("unicorns on mars", markets, groups, featured, now), null);
});

test("odds reply: question, prices, close time, link", () => {
  const f = findMarket("12", markets, groups, featured, now)!;
  assert.equal(
    oddsReply(f, site, now),
    "Will the Fed cut rates in December 2026?\nYES 47¢ · NO 53¢ · closes in 3d\nhttps://oraclemarkets.app/market/12",
  );
  const g = oddsReply(findMarket("77", markets, groups, featured, now)!, site, now);
  assert.match(g, /SOL 34¢ · BTC 33¢ · closes in 91d\nhttps:\/\/oraclemarkets\.app\/group\/77$/);
});

test("replies stay under X's 280 limit (URL counts as 23)", () => {
  const long = mk({ marketId: 20, name: "Will ".padEnd(400, "x") + "?" });
  const r = oddsReply({ kind: "market", m: long }, site, now);
  const [textPart] = r.split(site);
  assert.ok(textPart!.length + 23 <= 280, `len ${textPart!.length}`);
});

test("markets reply: top featured live markets + one link", () => {
  const r = marketsReply(markets, featured, site, now);
  assert.equal(
    r,
    "Trending on Oracle Markets:\n• Will SOL close above $200 on Oct 4, 2026? YES 52¢\n• Will the Fed cut rates in December 2026? YES 47¢\nhttps://oraclemarkets.app/markets?ref=x",
  );
});

test("not found reply links the market list", () => {
  assert.equal(
    notFoundReply("unicorns", site),
    "No market matches \"unicorns\" yet. Here's what's live: https://oraclemarkets.app/markets?ref=x",
  );
});
