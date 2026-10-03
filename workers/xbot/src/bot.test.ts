import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey } from "@solana/web3.js";
import type { PmAmmClient } from "@pm-amm/sdk";
import { handleMention, type BotCtx } from "./bot";
import { followUpCommand, type PendingBet } from "./betting";
import type { XbotConfig } from "./config";
import type { Store } from "./store";
import type { Mention } from "./xapi";

const BOT = "1850982569074180096";

/** In-memory stand-ins for Redis, X and the chain — enough for the bet flow. */
function harness() {
  const kv = new Map<string, string>();
  const replies: { text: string; to: string; id: string }[] = [];
  const opened: string[] = [];
  const store = {
    markSeen: async (id: string) => !kv.has(`seen:${id}`) && !!kv.set(`seen:${id}`, "1"),
    takeCooldown: async (u: string) => !kv.has(`cd:${u}`) && !!kv.set(`cd:${u}`, "1"),
    repliesToday: async () => 0,
    countReply: async () => {},
    count: async () => 0,
    bump: async () => 1,
    betForPost: async (id: string) => kv.get(`post:${id}`) ?? null,
    saveBet: async (meta: { vaultId: number }, post: string | null) =>
      void (post && kv.set(`post:${post}`, String(meta.vaultId))),
    setCategory: async () => 0,
    savePendingBet: async (id: string, p: PendingBet) => kv.set(`pending:${id}`, JSON.stringify(p)),
    pendingBet: async (id: string) => JSON.parse(kv.get(`pending:${id}`) ?? "null"),
    snapshot: async () => ({ markets: [], groups: [] }),
  } as unknown as Store;
  const betClient = {
    connection: { getBalance: async () => 1e9 },
    send: {
      createBetVault: async (a: { name: string }) => {
        opened.push(a.name);
        return { vaultId: 42, betVaultPda: "pda", signature: "sig" };
      },
    },
  } as unknown as PmAmmClient;
  const cfg = {
    siteUrl: "https://oraclemarkets.app",
    dryRun: false,
    dailyReplyCap: 100,
    featured: new Set<string>(),
    x: { botUserId: BOT },
    bets: {
      wallet: Keypair.generate(),
      resolver: new PublicKey("11111111111111111111111111111111"),
      stakeWindowSecs: 3600,
      minTotalUsdc: 2,
      lpBps: 5000,
      perDay: 10,
      perUserPerDay: 2,
      minLamports: 0,
    },
  } as unknown as XbotConfig;
  let n = 0;
  const source = {
    fetchMentions: async () => ({ mentions: [], newestId: null }),
    reply: async (text: string, to: string) => {
      const id = `bot-${++n}`;
      replies.push({ text, to, id });
      return id;
    },
  };
  const ctx: BotCtx = { cfg, store, source, betClient, botUserId: BOT, claude: null };
  return { ctx, replies, opened };
}

const take = {
  id: "take",
  text: "Denver gets 2+ feet of snow this month",
  username: "bangerboard",
  authorId: "7",
};

test("the thread from X: a deadline answer to the bot opens the bet on the ORIGINAL take", async () => {
  const { ctx, replies, opened } = harness();
  const far = new Date(Date.now() + 60 * 86_400_000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  const first: Mention = {
    id: "m1",
    text: `@bangerboard @daotao23 bet? by ${far}`,
    authorId: "8",
    username: "seedcoin1",
    parent: take,
  };
  await handleMention(ctx, first);
  assert.match(replies[0]!.text, /Pick a deadline between/);
  assert.equal(opened.length, 0);

  const botPost = {
    id: replies[0]!.id,
    text: replies[0]!.text,
    username: "daotao23",
    authorId: BOT,
  };
  const soon = new Date(Date.now() + 5 * 86_400_000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  // Same user, 3 minutes later: answers to the bot's question skip the cooldown.
  const answer: Mention = {
    id: "m2",
    text: `@daotao23 @bangerboard ${soon}`,
    authorId: "8",
    username: "seedcoin1",
    parent: botPost,
  };
  await handleMention(ctx, answer);
  assert.deepEqual(
    opened,
    ["Denver gets 2+ feet of snow this month"],
    "the take, never the bot's words",
  );
  assert.match(replies[1]!.text, /Bet's open: "Denver gets 2\+ feet/);

  // Someone else answering the same question gets the existing bet.
  const late: Mention = { ...answer, id: "m3", authorId: "7", username: "bangerboard" };
  await handleMention(ctx, late);
  assert.equal(opened.length, 1);
  assert.match(replies[2]!.text, /already a bet/);
});

test("a reply to a bot post with nothing pending never uses the bot's text as the take", async () => {
  const { ctx, replies, opened } = harness();
  const botPost = { id: "old", text: "Bet's open: whatever", username: "daotao23", authorId: BOT };
  await handleMention(ctx, {
    id: "m1",
    text: "@daotao23 bet? by Oct 30",
    authorId: "8",
    username: "x",
    parent: botPost,
  });
  assert.equal(opened.length, 0);
  assert.match(replies[0]!.text, /under the take/);
});

test("followUpCommand: date, window and hashtag from the answer; question from the original", () => {
  const p: PendingBet = { take, question: null, windowSecs: 7200, category: "weather" };
  const now = new Date("2026-10-03T00:00:00Z");
  const c = followUpCommand("@daotao23 @bangerboard Oct 4", p, now);
  assert.equal(c.deadline?.toISOString().slice(0, 10), "2026-10-04");
  assert.equal(c.question, null);
  assert.equal(c.windowSecs, 7200);
  assert.equal(c.category, "weather");
  const d = followUpCommand("@daotao23 Oct 20 in 30m #sports", p, now);
  assert.equal(d.windowSecs, 1800);
  assert.equal(d.category, "sports");
  assert.equal(followUpCommand("@daotao23", p, now).deadline, null);
  assert.equal(followUpCommand("@daotao23 sometime", p, now).deadline, null);
});
