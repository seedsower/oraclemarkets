import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey } from "@solana/web3.js";
import { createOne, reconcile, PENDING_EXPIRY_MS, type Chain, type Kv } from "./create";
import { K } from "./keys";
import {
  ATTRIBUTION,
  endTsFor,
  loadCreateConfig,
  planFor,
  priceBps,
  roundRobin,
  type Plan,
} from "./plan";
import type { Question } from "./question";
import type { Selected } from "./select";

const NOW = new Date("2026-11-23T12:00:00Z");
const cfg = loadCreateConfig({});

function memKv(): Kv & {
  data: Map<string, string>;
  hashes: Map<string, Map<string, string>>;
  sets: Map<string, Set<string>>;
} {
  const data = new Map<string, string>();
  const hashes = new Map<string, Map<string, string>>();
  const sets = new Map<string, Set<string>>();
  const h = (k: string) => hashes.get(k) ?? hashes.set(k, new Map()).get(k)!;
  return {
    data,
    hashes,
    sets,
    get: async (k) => data.get(k) ?? null,
    set: async (k, v) => data.set(k, v),
    hget: async (k, f) => h(k).get(f) ?? null,
    hset: async (k, f, v) => h(k).set(f, v),
    hdel: async (k, f) => h(k).delete(f),
    hgetall: async (k) => Object.fromEntries(h(k)),
    sadd: async (k, m) => (sets.get(k) ?? sets.set(k, new Set()).get(k)!).add(m),
  };
}

const pdas = new Map<number, PublicKey>();
function fakeChain(opts: { existing?: Set<number>; fail?: (id: number) => Error | null } = {}) {
  const sent: number[] = [];
  const created = new Set<string>();
  const chain: Chain = {
    marketPda: (id) => pdas.get(id) ?? pdas.set(id, Keypair.generate().publicKey).get(id)!,
    fetchMarket: async (pk) =>
      [...(opts.existing ?? [])].some((id) => chain.marketPda(id).equals(pk)) ||
      created.has(pk.toBase58())
        ? {}
        : null,
    send: {
      createMarket: async (i) => {
        sent.push(i.marketId);
        const err = opts.fail?.(i.marketId);
        if (err) throw err;
        created.add(chain.marketPda(i.marketId).toBase58());
        return {
          marketId: i.marketId,
          marketPda: chain.marketPda(i.marketId).toBase58(),
          signature: `sig${i.marketId}`,
        };
      },
    },
  };
  return { chain, sent, created };
}

const question = (over: Partial<Question> = {}): Question => ({
  id: "q1",
  title: "Will BTC close above $120k on Dec 31?",
  text: "Will Bitcoin close above $120,000 on December 31, 2026?",
  category: "Crypto",
  status: "active",
  closeAt: new Date("2026-12-31T00:00:00Z"),
  criteria: "YES if the Coinbase close is above $120k.",
  url: "https://oraclemarkets.io/predictions/q1",
  outcomes: 1,
  p: 0.31,
  agentCount: 9,
  updatedAt: NOW,
  venue: false,
  trendingRank: null,
  ...over,
});
const sel = (over: Partial<Question> = {}): Selected => ({
  question: question(over),
  title: "BTC above $120k on Dec 31?",
  score: 0.5,
});
const plan = (over: Partial<Question> = {}) => planFor(sel(over), cfg, NOW) as Plan;

test("create config: dry run unless explicitly false; defaults", () => {
  assert.equal(loadCreateConfig({}).dryRun, true);
  assert.equal(loadCreateConfig({ CURATOR_DRY_RUN: "no" }).dryRun, true);
  assert.equal(loadCreateConfig({ CURATOR_DRY_RUN: "FALSE" }).dryRun, false);
  assert.deepEqual([cfg.seedUsdc, cfg.closeBufferHours, cfg.maxNewPerRun], [50, 24, 40]);
});

test("price clamp 500–9500 bps", () => {
  assert.equal(priceBps(0.31, cfg), 3100);
  assert.equal(priceBps(0.01, cfg), 500);
  assert.equal(priceBps(0.999, cfg), 9500);
  assert.equal(priceBps(0.12345, cfg), 1235);
});

test("deadline = partner close − buffer; too close is skipped", () => {
  assert.equal(
    endTsFor(new Date("2026-12-31T00:00:00Z"), 24),
    Date.parse("2026-12-30T00:00:00Z") / 1000,
  );
  const p = plan();
  assert.equal(p.endTs, Date.parse("2026-12-30T00:00:00Z") / 1000);
  assert.equal(p.priceBps, 3100);
  assert.equal(p.category, "crypto");
  assert.equal(p.meta.attribution, ATTRIBUTION);
  assert.equal(p.meta.title, question().title);
  const soon = planFor(sel({ closeAt: new Date(NOW.getTime() + 24.5 * 3_600_000) }), cfg, NOW);
  assert.deepEqual(soon, { skip: "deadline (close − buffer) too close" });
  assert.equal(plan({ category: "Other" }).category, "other");
  assert.equal(plan({ category: "Climate" }).category, "climate");
  assert.equal(plan({ category: "Economics" }).category, "economics");
});

test("round-robin across categories", () => {
  assert.deepEqual(roundRobin({ a: [1, 2, 3], b: [4], c: [5, 6] }), [1, 4, 5, 2, 6, 3]);
});

test("creates once, writes every record; a second run creates nothing", async () => {
  const kv = memKv();
  const { chain, sent } = fakeChain();
  let id = 100;
  const deps = { kv, chain, now: () => NOW, newId: () => id++ };
  const out = await createOne(deps, plan());
  assert.equal(out.status, "created");
  const market = (out as { market: string }).market;
  assert.equal(kv.data.get(K.link("q1")), market);
  assert.equal(kv.data.get(K.linkMarket(market)), "q1");
  assert.equal(JSON.parse(kv.data.get(K.meta(market))!).source, "oraclemarkets.io");
  assert.equal(kv.hashes.get(K.categories)!.get(market), "crypto");
  assert.equal(kv.hashes.get(K.source)!.get(market), "oraclemarkets.io");
  assert.ok(kv.sets.get(K.featured)!.has(market));
  assert.equal(kv.hashes.get(K.pending)!.size, 0);
  assert.deepEqual(await createOne(deps, plan()), { status: "linked", market });
  assert.equal(sent.length, 1);
});

test("an occupied id is skipped before sending; 'already in use' retries with a new id", async () => {
  let id = 1;
  const { chain, sent } = fakeChain({
    existing: new Set([1]),
    fail: (n) => (n === 2 ? new Error("Allocate: account Address { … } already in use") : null),
  });
  const out = await createOne({ kv: memKv(), chain, now: () => NOW, newId: () => id++ }, plan());
  assert.equal(out.status, "created");
  assert.deepEqual(sent, [2, 3]);
});

test("a failed send keeps the pending record; reconcile finishes or drops it", async () => {
  const kv = memKv();
  const landed = fakeChain({ fail: () => new Error("blockhash expired") });
  const out = await createOne({ kv, chain: landed.chain, now: () => NOW, newId: () => 7 }, plan());
  assert.equal(out.status, "failed");
  assert.ok(kv.hashes.get(K.pending)!.has("q1"));
  assert.equal(
    (await createOne({ kv, chain: landed.chain, now: () => NOW }, plan())).status,
    "pending",
  );
  // the transaction did land after all → reconcile writes the links
  const onChain = fakeChain({ existing: new Set([7]) });
  onChain.chain.marketPda = landed.chain.marketPda;
  assert.deepEqual(await reconcile({ kv, chain: onChain.chain, now: () => NOW }), {
    finished: ["q1"],
    dropped: [],
  });
  assert.equal(kv.data.get(K.link("q1")), landed.chain.marketPda(7).toBase58());
  // a record whose tx never landed is dropped only after it expires
  const kv2 = memKv();
  await createOne({ kv: kv2, chain: landed.chain, now: () => NOW, newId: () => 8 }, plan());
  assert.deepEqual(await reconcile({ kv: kv2, chain: landed.chain, now: () => NOW }), {
    finished: [],
    dropped: [],
  });
  const later = () => new Date(NOW.getTime() + PENDING_EXPIRY_MS + 1);
  assert.deepEqual(await reconcile({ kv: kv2, chain: landed.chain, now: later }), {
    finished: [],
    dropped: ["q1"],
  });
});
