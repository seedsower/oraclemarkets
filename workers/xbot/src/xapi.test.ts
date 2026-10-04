import { test } from "node:test";
import assert from "node:assert/strict";
import { XApi } from "./xapi";
import type { Store } from "./store";

const store = { usage: async () => {} } as unknown as Store;

function stubFetch(responses: { status: number; body: unknown }[]) {
  const sent: Record<string, unknown>[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)));
    const r = responses.shift()!;
    return new Response(JSON.stringify(r.body), { status: r.status });
  }) as typeof fetch;
  return { sent, restore: () => (globalThis.fetch = original) };
}

test("reply falls back to a quote post when the thread restricts replies", async () => {
  const s = stubFetch([
    {
      status: 403,
      body: {
        detail:
          "You are not allowed to reply to this Tweet as the Tweet author has restricted who can reply to this Tweet.",
      },
    },
    { status: 201, body: { data: { id: "q1" } } },
  ]);
  try {
    const api = new XApi(async () => "auth", "bot", store);
    assert.equal(await api.reply("Bet's open", "m1"), "q1");
    assert.deepEqual(s.sent[0], { text: "Bet's open", reply: { in_reply_to_tweet_id: "m1" } });
    assert.deepEqual(s.sent[1], { text: "Bet's open", quote_tweet_id: "m1" });
  } finally {
    s.restore();
  }
});

test("other reply errors still throw (no quote spam)", async () => {
  const s = stubFetch([{ status: 403, body: { detail: "duplicate content" } }]);
  try {
    const api = new XApi(async () => "auth", "bot", store);
    await assert.rejects(api.reply("hi", "m1"), /reply 403: duplicate content/);
    assert.equal(s.sent.length, 1);
  } finally {
    s.restore();
  }
});
