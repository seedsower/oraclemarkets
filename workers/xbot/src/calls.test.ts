import { test } from "node:test";
import assert from "node:assert/strict";
import { callStatus, handleCall, parseCall, DISPUTE_WINDOW_SECS, type CallRecord } from "./calls";
import type { Store } from "./store";
import type { Mention } from "./xapi";

test("parseCall", () => {
  assert.deepEqual(parseCall("resolve YES"), { kind: "call", side: "yes" });
  assert.deepEqual(parseCall("settle: no"), { kind: "call", side: "no" });
  assert.deepEqual(parseCall("dispute, he never got up"), { kind: "dispute" });
  assert.equal(parseCall("resolve"), null);
  assert.equal(parseCall("buy YES $5"), null);
  assert.equal(parseCall("will it resolve yes?"), null);
});

test("callStatus: agree → ready, lone call waits 24h, disagreement or dispute → disputed", () => {
  const t = 1_000_000;
  const one: CallRecord = { calls: { a: { side: "yes", handle: "a", at: t } }, disputes: {} };
  assert.deepEqual(callStatus(one, t + 10), {
    kind: "pending",
    side: "yes",
    readyAt: t + DISPUTE_WINDOW_SECS,
  });
  assert.deepEqual(callStatus(one, t + DISPUTE_WINDOW_SECS), {
    kind: "ready",
    side: "yes",
    why: "uncontested",
  });
  const two = { ...one, calls: { ...one.calls, b: { side: "yes" as const, handle: "b", at: t } } };
  assert.deepEqual(callStatus(two, t), { kind: "ready", side: "yes", why: "agreed" });
  const split = { ...one, calls: { ...one.calls, b: { side: "no" as const, handle: "b", at: t } } };
  assert.equal(callStatus(split, t).kind, "disputed");
  assert.equal(callStatus({ ...one, disputes: { c: { handle: "c", at: t } } }, t).kind, "disputed");
  assert.equal(callStatus(null, t).kind, "none");
});

/** A launched, ended bet in the cache + a Redis stand-in. */
function fakeStore(over: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  const bet = {
    publicKey: "VAULT",
    vaultId: 77,
    launched: true,
    settled: false,
    voided: false,
    refunding: false,
    commitEndTs: now - 7200,
    marketEndTs: now - 60,
    market: "MKT",
    ...over,
  };
  const kv = new Map<string, string>([
    ["bets:meta:77", JSON.stringify({ openedBy: "Caller", openerId: "1", takeAuthorId: "2" })],
  ]);
  const store = {
    snapshot: async () => ({ markets: [], groups: [] }),
    betVaults: async () => [bet],
    betForPost: async () => null,
    redis: {
      get: async (k: string) => kv.get(k) ?? null,
      hget: async (k: string, f: string) => kv.get(`${k}/${f}`) ?? null,
      hset: async (k: string, f: string, v: string) => kv.set(`${k}/${f}`, v),
      sismember: async (k: string, m: string) => (kv.has(`${k}#${m}`) ? 1 : 0),
    },
  } as unknown as Store;
  return { store, kv };
}

const mention = (authorId: string, username: string, text: string): Mention => ({
  id: `${authorId}-${text}`,
  text,
  authorId,
  username,
  parent: null,
  urls: ["https://oraclemarkets.app/bet/77"],
});

test("handleCall: parties only; two matching calls are ready; the bot signs nothing", async () => {
  const { store, kv } = fakeStore();
  const outsider = await handleCall(store, mention("9", "rando", "resolve YES"), {
    kind: "call",
    side: "yes",
  });
  assert.match(outsider, /Only people in this bet/);
  const first = await handleCall(store, mention("1", "caller", "resolve YES"), {
    kind: "call",
    side: "yes",
  });
  assert.match(first, /says YES.*within 24h/s);
  const second = await handleCall(store, mention("2", "taker", "resolve YES"), {
    kind: "call",
    side: "yes",
  });
  assert.match(second, /Both sides say YES/);
  const rec = JSON.parse(kv.get("bet:calls/VAULT")!) as CallRecord;
  assert.deepEqual(Object.keys(rec.calls).sort(), ["1", "2"]);
});

test("handleCall: too early, never launched, already settled", async () => {
  const now = Math.floor(Date.now() / 1000);
  const call = { kind: "call", side: "yes" } as const;
  const early = fakeStore({ marketEndTs: now + 3600 });
  assert.match(await handleCall(early.store, mention("1", "c", "resolve YES"), call), /Too early/);
  const never = fakeStore({ launched: false });
  assert.match(await handleCall(never.store, mention("1", "c", "x"), call), /never launched/);
  const done = fakeStore({ settled: true });
  assert.match(await handleCall(done.store, mention("1", "c", "x"), call), /already settled/);
});
