import { test } from "node:test";
import assert from "node:assert/strict";
import { announcePass, announcementText, ANNOUNCE_KEY } from "./announce";

const SITE = "https://oraclemarkets.app";

/** X's length: every link counts as 23. */
const xLength = (t: string) => [...t.replace(/https?:\/\/\S+/g, "x".repeat(23))].length;

test("text: headline, titles, link; fits 280 even with long titles", () => {
  const t = announcementText({ count: 1, titles: ["Will the Fed cut in December?"] }, SITE);
  assert.match(t, /^🔮 1 new market, opened at the AI consensus/);
  assert.match(t, /• Will the Fed cut in December\?/);
  assert.ok(t.endsWith(`${SITE}/markets?category=oracle`));
  const long = "Will " + "a very long question ".repeat(10) + "happen?";
  const t2 = announcementText({ count: 7, titles: [long, long, long] }, SITE);
  assert.ok(xLength(t2) <= 280, String(xLength(t2)));
  assert.match(t2, /…and 4 more/);
  assert.match(t2, /🔮 7 new markets/);
});

function fakeStore(items: string[]) {
  const list = [...items];
  return {
    list,
    redis: {
      lpop: async (k: string) => (k === ANNOUNCE_KEY ? (list.shift() ?? null) : null),
      lpush: async (_k: string, v: string) => list.unshift(v),
    },
  };
}

test("posts one queued announcement per pass", async () => {
  const s = fakeStore([
    JSON.stringify({ count: 2, titles: ["A?", "B?"] }),
    JSON.stringify({ count: 1, titles: ["C?"] }),
  ]);
  const posted: string[] = [];
  await announcePass(s as never, { tweet: async (t) => (posted.push(t), "1") }, SITE);
  assert.equal(posted.length, 1);
  assert.match(posted[0]!, /• A\?\n• B\?/);
  assert.equal(s.list.length, 1);
});

test("a failed post is re-queued; junk is dropped", async () => {
  const item = JSON.stringify({ count: 1, titles: ["A?"] });
  const s = fakeStore([item]);
  await assert.rejects(
    announcePass(
      s as never,
      {
        tweet: async () => {
          throw new Error("402");
        },
      },
      SITE,
    ),
  );
  assert.deepEqual(s.list, [item]);
  const junk = fakeStore(["not json", JSON.stringify({ count: 0, titles: [] })]);
  const posted: string[] = [];
  await announcePass(junk as never, { tweet: async (t) => (posted.push(t), "1") }, SITE);
  await announcePass(junk as never, { tweet: async (t) => (posted.push(t), "1") }, SITE);
  assert.equal(posted.length, 0);
  assert.equal(junk.list.length, 0);
});
