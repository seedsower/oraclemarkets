import { test } from "node:test";
import assert from "node:assert/strict";
import { callStatus, DISPUTE_WINDOW_SECS } from "./bet-calls";

test("bet calls: same rules as the bot", () => {
  const t = 5_000;
  const one = { calls: { a: { side: "no" as const, handle: "a", at: t } }, disputes: {} };
  assert.equal(callStatus(one, t).kind, "pending");
  assert.deepEqual(callStatus(one, t + DISPUTE_WINDOW_SECS), {
    kind: "ready",
    side: "no",
    why: "uncontested",
  });
  assert.equal(callStatus({ ...one, disputes: { b: { handle: "b", at: t } } }, t).kind, "disputed");
  assert.equal(callStatus(undefined, t).kind, "none");
});
