import { test } from "node:test";
import assert from "node:assert/strict";
import { cents, closesIn, legLabel, marketSummary, tradeShareText, xIntentUrl } from "./share";

test("cents rounds and clamps the extremes", () => {
  assert.equal(cents(0.342), "34¢");
  assert.equal(cents(0.001), "<1¢");
  assert.equal(cents(0.999), ">99¢");
  assert.equal(cents(0), "0¢");
  assert.equal(cents(1), "100¢");
});

test("closesIn picks the largest unit", () => {
  const now = 1_000_000;
  assert.equal(closesIn(now + 3 * 86_400 + 5, now), "closes in 3d");
  assert.equal(closesIn(now + 5 * 3_600, now), "closes in 5h");
  assert.equal(closesIn(now + 30, now), "closes in 1m");
  assert.equal(closesIn(now - 1, now), "closed");
});

test("marketSummary matches the metadata format", () => {
  const endTs = Math.floor(Date.now() / 1000) + 3 * 86_400 + 60;
  assert.equal(
    marketSummary({ price: 0.34, endTs, resolved: false, winningSide: 0 }),
    "YES 34¢ · NO 66¢ · closes in 3d",
  );
  assert.equal(marketSummary({ price: 1, endTs, resolved: true, winningSide: 1 }), "Resolved: YES");
});

test("trade copy: side + price only unless the amount is opted in", () => {
  const base = {
    mode: "buy" as const,
    side: "yes" as const,
    price: 0.34,
    question: "Will it ship?",
  };
  assert.equal(tradeShareText(base), "I'm buying YES at 34¢ on: Will it ship?");
  assert.equal(tradeShareText({ ...base, side: "no" }), "I'm buying NO at 66¢ on: Will it ship?");
  assert.equal(
    tradeShareText({ ...base, amount: { value: 25, symbol: "USDC" } }),
    "I'm buying 25 USDC of YES at 34¢ on: Will it ship?",
  );
});

test("xIntentUrl encodes text and url", () => {
  const u = new URL(xIntentUrl("YES 34¢ & more", "https://example.com/market/1"));
  assert.equal(u.origin + u.pathname, "https://x.com/intent/post");
  assert.equal(u.searchParams.get("text"), "YES 34¢ & more");
  assert.equal(u.searchParams.get("url"), "https://example.com/market/1");
});

test("legLabel keeps only the outcome", () => {
  assert.equal(legLabel("Best performer in Q4 2026 - SOL"), "SOL");
  assert.equal(legLabel("Plain name"), "Plain name");
});

test("buy links: build and parse", async () => {
  const { buyPath, parseBuyIntent } = await import("./share");
  assert.equal(buyPath(42, "yes"), "/market/42?buy=yes&amount=5");
  assert.equal(buyPath("42", "no", 25), "/market/42?buy=no&amount=25");
  assert.deepEqual(parseBuyIntent("?buy=yes&amount=5"), { side: "yes", amount: 5 });
  assert.deepEqual(parseBuyIntent("?buy=NO&amount=12.5"), { side: "no", amount: 12.5 });
  assert.deepEqual(parseBuyIntent("?buy=yes"), { side: "yes", amount: 5 });
  assert.deepEqual(parseBuyIntent("?buy=yes&amount=-3"), { side: "yes", amount: 5 });
  assert.deepEqual(parseBuyIntent("?buy=yes&amount=1e9"), { side: "yes", amount: 5 });
  assert.equal(parseBuyIntent("?buy=maybe&amount=5"), null);
  assert.equal(parseBuyIntent(""), null);
});

test("wallet browse deeplinks match the documented format", async () => {
  const { walletBrowseLinks } = await import("./wallet-links");
  const l = walletBrowseLinks(
    "https://oraclemarkets.app/market/1?buy=yes&amount=5",
    "https://oraclemarkets.app",
  );
  assert.equal(
    l.phantom,
    "https://phantom.app/ul/browse/https%3A%2F%2Foraclemarkets.app%2Fmarket%2F1%3Fbuy%3Dyes%26amount%3D5?ref=https%3A%2F%2Foraclemarkets.app",
  );
  assert.ok(
    l.solflare.startsWith(
      "https://solflare.com/ul/v1/browse/https%3A%2F%2Foraclemarkets.app%2Fmarket%2F1%3Fbuy%3Dyes",
    ),
  );
});
