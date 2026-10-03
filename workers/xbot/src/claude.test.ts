import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  Claude,
  mergeAssist,
  needsAssist,
  toCommand,
  toRefined,
  type ClaudeConfig,
} from "./claude";
import { parseCommand } from "./commands";
import { applyRefinement, planBet } from "./betting";
import type { BetsConfig } from "./config";

const cfg: ClaudeConfig = {
  apiKey: "test",
  model: "m",
  refineModel: "r",
  perDay: 2,
  timeoutMs: 1000,
};

/** A fetch that answers every call with one tool_use block (and records the requests). */
function fakeFetch(input: Record<string, unknown>, status = 200) {
  const calls: Record<string, unknown>[] = [];
  const f = (async (_url: string, init: RequestInit) => {
    calls.push(JSON.parse(String(init.body)));
    const body = {
      content: [
        { type: "tool_use", name: (calls.at(-1)!.tool_choice as { name: string }).name, input },
      ],
    };
    return new Response(status === 200 ? JSON.stringify(body) : "boom", { status });
  }) as unknown as typeof fetch;
  return { f, calls };
}

function memCounter() {
  const n = new Map<string, number>();
  return {
    bump: async (k: string) => (n.set(k, (n.get(k) ?? 0) + 1), n.get(k)!),
    count: async (k: string) => n.get(k) ?? 0,
  };
}

test("toCommand: bet with a relative date resolved to YYYY-MM-DD", () => {
  const c = toCommand({
    intent: "bet",
    question: "",
    deadline: "2026-12-24",
    window_minutes: 120,
    category: "sports",
  });
  assert.equal(c?.kind, "bet");
  if (c?.kind !== "bet") return;
  assert.equal(c.question, null, "empty → the parent post is the take");
  assert.equal(c.deadline?.toISOString(), "2026-12-24T00:00:00.000Z");
  assert.equal(c.windowSecs, 7200);
  assert.equal(c.category, "sports");
});

test("toCommand: junk is dropped, not trusted", () => {
  const c = toCommand({
    intent: "bet",
    question: "ok",
    deadline: "christmas",
    window_minutes: -5,
    category: "memes",
  });
  assert.deepEqual(c, {
    kind: "bet",
    question: null,
    by: null,
    deadline: null,
    windowSecs: null,
    category: null,
  });
  assert.equal(toCommand({ intent: "other" }), null);
  assert.equal(toCommand({ intent: "transfer_funds" }), null);
  assert.equal(toCommand({ intent: "odds", topic: "gm" }), null);
  assert.deepEqual(toCommand({ intent: "odds", topic: "fed rate cut" }), {
    kind: "odds",
    query: "fed rate cut",
  });
});

test("needsAssist: only free text, unparsed topical text, or a bet without a date", () => {
  const p = (t: string) => parseCommand(t, new Date("2026-10-03T00:00:00Z"));
  assert.equal(needsAssist(p("@b odds sol"), true), false);
  assert.equal(needsAssist(p("@b bet? by Oct 20"), true), false);
  assert.equal(needsAssist(p("@b bet? before christmas"), true), true);
  assert.equal(needsAssist(p("@b I'll take that, loser pays"), true), true);
  assert.equal(needsAssist(null, false), false, "small talk never calls Claude");
});

test("mergeAssist: Claude's bet wins, hashtags and windows from the rules stay", () => {
  const rule = parseCommand(
    "@b bet? before christmas in 2h #sports",
    new Date("2026-10-03T00:00:00Z"),
  );
  const ai = toCommand({
    intent: "bet",
    question: "",
    deadline: "2026-12-24",
    category: "culture",
  });
  const m = mergeAssist(rule, ai);
  assert.equal(m?.kind === "bet" && m.question, null);
  assert.equal(m?.kind === "bet" && m.windowSecs, 7200);
  assert.equal(m?.kind === "bet" && m.category, "sports");
  assert.equal(mergeAssist(rule, null), rule, "Claude down → rules");
  const q = parseCommand("@b sol price today");
  assert.equal(mergeAssist(q, null), q);
  assert.equal(mergeAssist(q, { kind: "markets" })?.kind, "markets");
});

test("toRefined: needs a real question and rules; refusals pass through", () => {
  assert.deepEqual(toRefined({ allowed: false, name: "x", rules: "y" }), {
    allowed: false,
    name: "",
    rules: "",
    category: null,
  });
  assert.equal(toRefined({ allowed: true, name: "", rules: "r", category: "crypto" }), null);
  assert.equal(toRefined({ allowed: "yes", name: "Will SOL flip ETH?", rules: "r" }), null);
  assert.equal(
    toRefined({ allowed: true, name: "Will SOL flip ETH?", rules: "r", category: "x" })?.category,
    null,
  );
});

test("Claude client: forced tool call, daily cap, fail-open on errors", async () => {
  const ok = fakeFetch({ intent: "markets" });
  const c = new Claude(cfg, memCounter(), ok.f);
  assert.deepEqual(await c.interpret("@b what's hot", null), { kind: "markets" });
  const sent = ok.calls[0]!;
  assert.equal(sent.model, "m");
  assert.deepEqual(sent.tool_choice, { type: "tool", name: "classify_mention" });
  assert.deepEqual(await c.interpret("@b again", null), { kind: "markets" });
  assert.equal(await c.interpret("@b over the cap", null), null, "3rd call > perDay 2");
  assert.equal(ok.calls.length, 2);

  const down = new Claude(cfg, memCounter(), fakeFetch({}, 500).f);
  assert.equal(await down.interpret("@b anything", null), null);
  assert.equal(await down.refineBet("SOL flips ETH", new Date()), null);
});

test("refineBet → applyRefinement: question + rules replace the take; hashtag wins", async () => {
  const out = {
    allowed: true,
    name: "Will SOL's market cap pass ETH's by Oct 20?",
    rules: "YES if CoinGecko shows SOL above ETH at any time before Oct 20 23:59 UTC.",
    category: "crypto",
  };
  const c = new Claude(cfg, memCounter(), fakeFetch(out).f);
  const refined = await c.refineBet(
    "SOL flips ETH this month, easy",
    new Date("2026-10-20T23:59:59Z"),
  );
  const bets = {
    wallet: Keypair.generate(),
    resolver: new PublicKey("11111111111111111111111111111111"),
    stakeWindowSecs: 3600,
  } as BetsConfig;
  const now = Math.floor(new Date("2026-10-03T00:00:00Z").getTime() / 1000);
  const cmd = parseCommand("@b bet? by Oct 20 #finance", new Date(now * 1000));
  const plan = planBet(
    cmd as never,
    {
      id: "2",
      text: "",
      authorId: "9",
      username: "c",
      parent: { id: "1", text: "SOL flips ETH this month, easy", username: "t" },
    },
    bets,
    now,
  );
  assert.equal(plan.action, "open");
  if (plan.action !== "open") return;
  const final = applyRefinement(plan, refined);
  assert.equal(final.question, out.name);
  assert.equal(final.take, "SOL flips ETH this month, easy");
  assert.equal(final.rules, out.rules);
  assert.equal(final.category, "finance", "the poster's hashtag wins over Claude's pick");
  assert.ok(new TextEncoder().encode(final.name).length <= 64);
  assert.equal(applyRefinement(plan, null).question, plan.question, "no Claude → the take");
});
