import { test } from "node:test";
import assert from "node:assert/strict";
import { errorMessage, RATE_LIMITED_MESSAGE } from "./errors";

test("RPC 429s become a plain message; other errors pass through", () => {
  const rpc = new Error(
    '429 : {"jsonrpc":"2.0","error":{"code": 429, "message":"Too many requests from your IP"}, "id": "838762f2"}',
  );
  assert.equal(errorMessage(rpc), RATE_LIMITED_MESSAGE);
  assert.ok(RATE_LIMITED_MESSAGE.length <= 80, "fits the shortest toast slice");
  assert.equal(errorMessage(new Error("User rejected the request.")), "User rejected the request.");
  assert.equal(errorMessage("custom program error: 0x1771"), "custom program error: 0x1771");
});
