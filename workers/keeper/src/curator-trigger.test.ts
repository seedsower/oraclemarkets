import { test } from "node:test";
import assert from "node:assert/strict";
import { loadTriggerConfig, maybeTriggerCurator, REQUEST_KEY, STATUS_KEY } from "./curator-trigger";

function fakeRedis(request: string | null) {
  const data = new Map<string, string>();
  if (request) data.set(REQUEST_KEY, request);
  return {
    data,
    getdel: async (k: string) => {
      const v = data.get(k) ?? null;
      data.delete(k);
      return v;
    },
    set: async (k: string, v: string) => (data.set(k, v), "OK" as const),
  };
}
const cfg = { token: "t", serviceId: "svc", environmentId: "env" };

test("config needs token, service id and environment id", () => {
  assert.equal(loadTriggerConfig({}), null);
  assert.deepEqual(
    loadTriggerConfig({
      CURATOR_TRIGGER_TOKEN: "t",
      CURATOR_SERVICE_ID: "svc",
      RAILWAY_ENVIRONMENT_ID: "env",
    }),
    cfg,
  );
});

test("no request → nothing happens", async () => {
  const r = fakeRedis(null);
  assert.equal(await maybeTriggerCurator(r as never, cfg, (() => assert.fail()) as never), "none");
});

test("a request runs the cron job once, with the project token, and records it", async () => {
  const r = fakeRedis(JSON.stringify({ by: "A492", at: "2026-11-24T10:00:00Z" }));
  const calls: { headers: Record<string, string>; body: { query: string; variables: object } }[] =
    [];
  const f = (async (_url: string, init: { headers: Record<string, string>; body: string }) => {
    calls.push({ headers: init.headers, body: JSON.parse(init.body) });
    const data =
      calls.length === 1
        ? { serviceInstance: { id: "si-1" } }
        : { deploymentInstanceExecutionCreate: true };
    return { ok: true, json: async () => ({ data }) };
  }) as never;
  assert.equal(await maybeTriggerCurator(r as never, cfg, f), "triggered");
  assert.equal(calls.length, 2);
  assert.equal(calls[0]!.headers["Project-Access-Token"], "t");
  assert.match(calls[1]!.body.query, /deploymentInstanceExecutionCreate/);
  assert.deepEqual(calls[1]!.body.variables, { i: "si-1" });
  assert.equal(r.data.has(REQUEST_KEY), false);
  const status = JSON.parse(r.data.get(STATUS_KEY)!);
  assert.equal(status.by, "A492");
  assert.ok(status.triggeredAt);
  assert.equal(await maybeTriggerCurator(r as never, cfg, f), "none"); // consumed
});

test("Railway errors and a missing config are recorded, not thrown", async () => {
  const r = fakeRedis(JSON.stringify({ by: "x" }));
  const f = (async () => ({
    ok: true,
    json: async () => ({ errors: [{ message: "Not Authorized" }] }),
  })) as never;
  assert.equal(await maybeTriggerCurator(r as never, cfg, f), "failed");
  assert.equal(JSON.parse(r.data.get(STATUS_KEY)!).error, "Not Authorized");
  const r2 = fakeRedis(JSON.stringify({ by: "x" }));
  assert.equal(await maybeTriggerCurator(r2 as never, null), "disabled");
  assert.equal(JSON.parse(r2.data.get(STATUS_KEY)!).error, "trigger not configured");
});
