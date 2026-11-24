import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey } from "@solana/web3.js";
import { K } from "./keys";
import { refreshCurated, reviewFor, REVIEW_KEY, type LifecycleKv, type Lookup } from "./lifecycle";
import type { Question } from "./question";

const NOW = new Date("2026-12-01T12:00:00Z");
const q = (id: string, over: Partial<Question> = {}): Question => ({
  id,
  title: id,
  text: id,
  category: "Economics",
  status: "active",
  closeAt: new Date("2026-12-31T00:00:00Z"),
  criteria: "c",
  url: `https://oraclemarkets.io/predictions/${id}`,
  outcomes: 1,
  p: 0.62,
  agentCount: 9,
  updatedAt: new Date("2026-12-01T01:00:00Z"),
  venue: false,
  trendingRank: null,
  ...over,
});

function memKv() {
  const data = new Map<string, string>();
  const hashes = new Map<string, Map<string, string>>();
  const sets = new Map<string, Set<string>>();
  const h = (k: string) => hashes.get(k) ?? hashes.set(k, new Map()).get(k)!;
  const st = (k: string) => sets.get(k) ?? sets.set(k, new Set()).get(k)!;
  const kv: LifecycleKv = {
    hkeys: async (k) => [...h(k).keys()],
    get: async (k) => data.get(k) ?? null,
    set: async (k, v) => data.set(k, v),
    hset: async (k, f, v) => h(k).set(f, v),
    hsetnx: async (k, f, v) => (h(k).has(f) ? 0 : (h(k).set(f, v), 1)),
    hdel: async (k, f) => h(k).delete(f),
    sadd: async (k, m) => st(k).add(m),
    srem: async (k, m) => st(k).delete(m),
  };
  return { kv, data, h, st };
}

test("reviewFor: active → nothing; resolved, void, gone → entries", () => {
  const look = (o: Partial<Question> | null, error?: string): Lookup => ({
    question: o ? q("x", o) : null,
    error,
  });
  assert.equal(reviewFor("m", "x", "u", look({}), NOW), null);
  assert.equal(
    reviewFor("m", "x", "u", look({ status: "resolved" }), NOW)!.kind,
    "partner-resolved",
  );
  assert.equal(reviewFor("m", "x", "u", look({ status: "void" }), NOW)!.kind, "partner-void");
  const gone = reviewFor("m", "x", "u", look(null, "Question not found"), NOW)!;
  assert.equal(gone.kind, "partner-gone");
  assert.match(gone.note, /not found.*check the source/);
  assert.equal(gone.at, NOW.toISOString());
});

test("refreshCurated: refresh, feature/unfeature, review, resolved, unknown", async () => {
  const { kv, data, h, st } = memKv();
  const m = Array.from({ length: 5 }, () => Keypair.generate().publicKey.toBase58());
  const qids = ["top", "dropped", "gone", "done", "unknown"];
  m.forEach((mk, i) => {
    h(K.source).set(mk, "oraclemarkets.io");
    data.set(K.linkMarket(mk), qids[i]!);
    data.set(
      K.meta(mk),
      JSON.stringify({ consensus: 0.5, url: `https://oraclemarkets.io/predictions/${qids[i]}` }),
    );
    st(K.featured).add(mk);
  });
  h(REVIEW_KEY).set(m[1]!, "{}"); // stale entry for a question that is active again
  const resolved = new Set([m[3]]);
  const lookups: string[] = [];
  const r = await refreshCurated(
    {
      kv,
      fetchMarket: async (pk: PublicKey) => ({ resolved: resolved.has(pk.toBase58()) }),
      toKey: (s) => new PublicKey(s),
      lookup: async (id) => {
        lookups.push(id);
        if (id === "dropped") return { question: q(id, { category: "Climate", p: 0.3 }) };
        if (id === "gone") return { question: null, error: "not found" };
        return null; // "unknown": transport error
      },
      now: () => NOW,
    },
    new Set(["top"]),
    new Map([["top", q("top")]]),
  );
  assert.deepEqual(lookups, ["dropped", "gone", "unknown"]); // "top" came from the pool
  assert.deepEqual(
    [r.refreshed, r.featured, r.unfeatured, r.resolved, r.review.length],
    [2, 1, 1, 1, 1],
  );
  const meta = JSON.parse(data.get(K.meta(m[0]!))!);
  assert.equal(meta.aiNow, 0.62);
  assert.equal(meta.consensus, 0.5); // opening line kept
  assert.equal(meta.aiNowAt, "2026-12-01T01:00:00.000Z");
  assert.equal(h(K.categories).get(m[1]!), "climate");
  assert.ok(st(K.featured).has(m[0]!)); // still top N
  assert.ok(!st(K.featured).has(m[1]!)); // fell out
  assert.ok(!st(K.featured).has(m[2]!)); // gone
  assert.ok(!st(K.featured).has(m[3]!)); // resolved
  assert.ok(st(K.featured).has(m[4]!)); // unknown: untouched
  assert.ok(!h(REVIEW_KEY).has(m[1]!)); // stale entry cleared
  assert.equal(JSON.parse(h(REVIEW_KEY).get(m[2]!)!).kind, "partner-gone");
  // a second sighting keeps the first entry's date
  h(REVIEW_KEY).set(m[2]!, JSON.stringify({ at: "first" }));
  await refreshCurated(
    {
      kv,
      fetchMarket: async () => ({ resolved: false }),
      toKey: (s) => new PublicKey(s),
      lookup: async () => ({ question: null }),
      now: () => NOW,
    },
    new Set(),
    new Map(),
  );
  assert.equal(JSON.parse(h(REVIEW_KEY).get(m[2]!)!).at, "first");
});
