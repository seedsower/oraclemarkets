import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  acquireLock,
  allowance,
  loadBudgetConfig,
  LOCK_KEY,
  openSeed,
  releaseLock,
  type LockKv,
} from "./budget";
import { K } from "./keys";

const cfg = loadBudgetConfig({});
const base = { maxNewPerRun: 40, seedUsdc: 50, openSeedUsdc: 0, usdc: 10_000, sol: 100 };

test("defaults", () => {
  assert.deepEqual(cfg, { maxOpenSeedUsdc: 3000, minSol: 0.5, solPerMarket: 0.05 });
});

test("per-run cap when nothing else binds", () => {
  const a = allowance(base, cfg);
  assert.equal(a.allowed, 40);
  assert.equal(a.limitedBy, "CURATOR_MAX_NEW_PER_RUN");
});

test("open-seed cap: strictly below 3000", () => {
  assert.equal(allowance({ ...base, openSeedUsdc: 2000 }, cfg).allowed, 19); // 2000 + 20×50 = 3000, not below
  assert.equal(allowance({ ...base, openSeedUsdc: 2001 }, cfg).allowed, 19);
  const full = allowance({ ...base, openSeedUsdc: 2990 }, cfg);
  assert.equal(full.allowed, 0);
  assert.equal(full.limitedBy, "CURATOR_MAX_OPEN_SEED_USDC");
  assert.equal(allowance({ ...base, openSeedUsdc: 3500 }, cfg).allowed, 0);
});

test("USDC balance: only what's affordable", () => {
  const a = allowance({ ...base, usdc: 149.99 }, cfg);
  assert.equal(a.allowed, 2);
  assert.equal(a.limitedBy, "USDC balance");
  assert.equal(allowance({ ...base, usdc: 150 }, cfg).allowed, 3);
});

test("SOL reserve: keep CURATOR_MIN_SOL", () => {
  const a = allowance({ ...base, sol: 0.7 }, cfg); // (0.7 − 0.5) / 0.05 = 4
  assert.equal(a.allowed, 4);
  assert.equal(a.limitedBy, "CURATOR_MIN_SOL");
  assert.equal(allowance({ ...base, sol: 0.4 }, cfg).allowed, 0);
});

test("openSeed counts unresolved curated markets only, seed from meta or fallback", async () => {
  const [a, b, c, d] = Array.from({ length: 4 }, () => Keypair.generate().publicKey.toBase58());
  const meta: Record<string, string> = {
    [K.meta(a!)]: JSON.stringify({ seedUsdc: 50 }),
    [K.meta(b!)]: JSON.stringify({ seedUsdc: 75 }),
    [K.meta(c!)]: JSON.stringify({ seedUsdc: 50 }),
  };
  const kv = { hkeys: async () => [a!, b!, c!, d!], get: async (k: string) => meta[k] ?? null };
  const state: Record<string, { resolved: boolean } | null> = {
    [a!]: { resolved: false },
    [b!]: { resolved: false },
    [c!]: { resolved: true },
    [d!]: { resolved: false }, // no meta → fallback 50
  };
  const chain = { fetchMarket: async (pk: PublicKey) => state[pk.toBase58()] ?? null };
  assert.equal(await openSeed(kv, chain, (s) => new PublicKey(s), 50), 175);
});

test("lock: one holder at a time; release only by the owner", async () => {
  const store = new Map<string, string>();
  const kv: LockKv = {
    set: async (k, v) => (store.has(k) ? null : (store.set(k, v), "OK")),
    eval: async (_s, _n, key, token) => (store.get(key!) === token ? store.delete(key!) : 0),
  };
  assert.equal(await acquireLock(kv, "run-1"), true);
  assert.equal(await acquireLock(kv, "run-2"), false);
  await releaseLock(kv, "run-2");
  assert.equal(store.get(LOCK_KEY), "run-1");
  await releaseLock(kv, "run-1");
  assert.equal(await acquireLock(kv, "run-2"), true);
});
