import { test } from "node:test";
import assert from "node:assert/strict";
import { memberToString, pairsFromFlat, toInt } from "./kv-normalize";

const a = JSON.stringify({ t: 100, p: 0.42 });
const b = JSON.stringify({ t: 160, p: 0.45 });

test("ioredis RESP2 flat WITHSCORES → pairs", () => {
  assert.deepEqual(pairsFromFlat([a, "100", b, "160"]), [
    { member: a, score: 100 },
    { member: b, score: 160 },
  ]);
});

test("RESP3 nested WITHSCORES → pairs", () => {
  assert.deepEqual(
    pairsFromFlat([
      [a, "100"],
      [b, 160],
    ]),
    [
      { member: a, score: 100 },
      { member: b, score: 160 },
    ],
  );
});

test("Upstash deserialized members are re-stringified", () => {
  assert.deepEqual(pairsFromFlat([{ t: 100, p: 0.42 }, 100]), [{ member: a, score: 100 }]);
});

test("empty and odd-length / non-numeric replies are safe", () => {
  assert.deepEqual(pairsFromFlat([]), []);
  assert.deepEqual(pairsFromFlat([a]), []);
  assert.deepEqual(pairsFromFlat([a, "nope"]), []);
});

test("scalar helpers", () => {
  assert.equal(memberToString("x"), "x");
  assert.equal(toInt("3"), 3);
  assert.equal(toInt(null), 0);
});
