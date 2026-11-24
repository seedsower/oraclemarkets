import { test } from "node:test";
import assert from "node:assert/strict";
import type Anthropic from "@anthropic-ai/sdk";
import { gatherPool, hitsIn, worthFetching } from "./pool";
import { classify } from "./policy";
import { loadConfig } from "./select";
import type { Question } from "./question";

const NOW = new Date("2026-11-23T12:00:00Z");
const cfg = loadConfig({ CURATOR_CATEGORIES: "Crypto" });

const get = (id: string, end = "2027-01-15") => ({
  structuredContent: {
    question: {
      id,
      display_title: id,
      question_text: id,
      category: "Crypto",
      status: "active",
      end_date: end,
      resolution_criteria: "c",
    },
    consensus: {
      last_updated: NOW.toISOString(),
      outcomes: [{ consensus_p_yes: 40, agent_count: 5 }],
    },
  },
});

test("hitsIn reads search and trending shapes", () => {
  const s = hitsIn({
    structuredContent: {
      results: [{ id: "a", category: "Crypto", status: "active", end_date: "2027-01-01" }],
    },
  });
  assert.deepEqual(s, [
    { id: "a", category: "Crypto", status: "active", end: "2027-01-01", rank: null },
  ]);
  const t = hitsIn({
    structuredContent: { trending: [{ rank: 2, question_id: "b", category: "Sports" }] },
  });
  assert.equal(t[0]!.id, "b");
  assert.equal(t[0]!.rank, 2);
});

test("worthFetching skips other categories and out-of-window dates", () => {
  const h = { id: "a", category: "Crypto", status: "active", end: "2027-01-15", rank: null };
  assert.equal(worthFetching(h, cfg, NOW), true);
  assert.equal(worthFetching({ ...h, category: "Sports" }, cfg, NOW), false);
  assert.equal(worthFetching({ ...h, end: "2026-11-24" }, cfg, NOW), false);
  assert.equal(worthFetching({ ...h, end: "2030-01-01" }, cfg, NOW), false);
});

test("gatherPool: trending rank kept, duplicates fetched once, call cap respected", async () => {
  const seen: string[] = [];
  const client = {
    callTool: async ({
      name,
      arguments: a,
    }: {
      name: string;
      arguments?: Record<string, unknown>;
    }) => {
      seen.push(`${name}:${String(a?.question_id ?? a?.query ?? "")}`);
      if (name === "list_trending_questions")
        return {
          structuredContent: {
            trending: [{ rank: 1, question_id: "t1", category: "Crypto", end_date: "2027-01-15" }],
          },
        };
      if (name === "search_predictions")
        return {
          structuredContent: {
            results: [
              { id: "t1", category: "Crypto", end_date: "2027-01-15" },
              { id: "s1", category: "Crypto", end_date: "2027-01-15" },
            ],
          },
        };
      return get(String(a!.question_id));
    },
  };
  const pool = await gatherPool(client as never, cfg, {
    maxCalls: 100,
    minIntervalMs: 0,
    now: NOW,
  });
  assert.deepEqual(
    pool.questions.map((q) => [q.id, q.trendingRank]),
    [
      ["t1", 1],
      ["s1", null],
    ],
  );
  assert.equal(seen.filter((s) => s.startsWith("get_prediction")).length, 2);
  const capped = await gatherPool(client as never, cfg, {
    maxCalls: 3,
    minIntervalMs: 0,
    now: NOW,
  });
  assert.equal(capped.calls, 3);
  assert.ok(capped.errors.some((e) => /cap reached/.test(e)));
});

const question = { id: "q", title: "t", text: "t", criteria: "c", category: "Crypto" } as Question;
const reply = (text: string, stop: Anthropic.StopReason = "end_turn") => ({
  messages: {
    create: async () =>
      ({ stop_reason: stop, content: [{ type: "text", text }] }) as unknown as Anthropic.Message,
  },
});

test("classify: allowed, rejected, refusal, malformed and errors fail closed", async () => {
  assert.deepEqual(await classify(reply('{"allowed":true,"reason":"market topic"}'), question), {
    ok: true,
    reason: "market topic",
  });
  assert.deepEqual(await classify(reply('{"allowed":false,"reason":"private person"}'), question), {
    ok: false,
    reason: "private person",
  });
  assert.equal((await classify(reply("", "refusal"), question)).ok, false);
  assert.equal((await classify(reply("not json"), question)).ok, false);
  assert.equal((await classify(reply('{"reason":"x"}'), question)).ok, false);
  const boom = {
    messages: {
      create: async () => {
        throw new Error("529 overloaded");
      },
    },
  };
  assert.match((await classify(boom, question)).reason, /529/);
});
