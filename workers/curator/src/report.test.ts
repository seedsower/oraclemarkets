import { test } from "node:test";
import assert from "node:assert/strict";
import {
  announcementFor,
  groupSkips,
  KEEP_RUNS,
  RUNS_KEY,
  saveReport,
  summarize,
  type ReportKv,
  type ReportRow,
  type RunReport,
} from "./report";

const row = (result: string, name = "Q?"): ReportRow => ({
  questionId: name,
  category: "Crypto",
  name,
  result,
});

function report(rows: ReportRow[], dryRun = false): RunReport {
  return {
    at: "2026-11-25T14:00:00.000Z",
    finishedAt: "2026-11-25T14:11:00.000Z",
    dryRun,
    trigger: "schedule",
    budget: null,
    seedUsdc: 50,
    selected: {},
    rows,
    skips: {},
    lifecycle: null,
    mcpCalls: 0,
    errors: [],
    summary: summarize(rows),
  };
}

test("skip reasons are grouped without their numbers", () => {
  assert.deepEqual(
    groupSkips([
      { reason: "closes in 2.5 d (< 3)" },
      { reason: "closes in 1.0 d (< 3)" },
      { reason: "consensus 2% outside 5–95%" },
      { reason: 'content policy (keyword): violence ("riot")' },
      { reason: 'content policy (keyword): violence ("attacks")' },
    ]),
    {
      "closes in # d (< #)": 2,
      "consensus #% outside #–#%": 1,
      'content policy (keyword): violence ("…")': 2,
    },
  );
});

test("summary counts", () => {
  const s = summarize([
    row("created"),
    row("created"),
    row("would create"),
    row("failed: blockhash expired"),
    row("already linked"),
    row("over budget (USDC balance)"),
  ]);
  assert.deepEqual(s, { created: 2, wouldCreate: 1, failed: 1, linked: 1, overBudget: 1 });
});

test("saveReport keeps only the newest 30", async () => {
  const data = new Map<string, string>();
  const z = new Map<string, number>();
  const kv: ReportKv = {
    set: async (k, v) => data.set(k, v),
    zadd: async (_k, score, m) => z.set(m, score),
    zrange: async (_k, start, stop) => {
      const sorted = [...z.entries()].sort((a, b) => a[1] - b[1]).map(([m]) => m);
      const end = Number(stop) < 0 ? sorted.length + Number(stop) : Number(stop);
      return end < start ? [] : sorted.slice(start, end + 1); // like Redis: empty range
    },
    zrem: async (_k, m) => z.delete(m),
    del: async (k) => data.delete(k),
  };
  for (let i = 1; i <= KEEP_RUNS + 5; i++) await saveReport(kv, i, report([]));
  assert.equal(z.size, KEEP_RUNS);
  assert.equal(data.size, KEEP_RUNS);
  assert.ok(!data.has(`${RUNS_KEY}:5`));
  assert.ok(data.has(`${RUNS_KEY}:6`));
  assert.ok(data.has(`${RUNS_KEY}:${KEEP_RUNS + 5}`));
});

test("an announcement only for a live run that created markets", () => {
  assert.equal(announcementFor(report([row("would create")], true)), null);
  assert.equal(announcementFor(report([row("already linked")])), null);
  const a = announcementFor(
    report([
      row("created", "A?"),
      row("created", "B?"),
      row("created", "C?"),
      row("created", "D?"),
    ]),
  )!;
  assert.equal(a.count, 4);
  assert.deepEqual(a.titles, ["A?", "B?", "C?"]);
});
