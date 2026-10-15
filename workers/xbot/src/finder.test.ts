import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeList, rankOf, readVerdicts, toCandidate, type Candidate } from "./finder";
import type { FoundPost } from "./xapi";

const post = (over: Partial<FoundPost> = {}): FoundPost => ({
  id: "1",
  text: "BTC hits 150k before Halloween, mark my words",
  authorId: "9",
  username: "hodler",
  followers: 1200,
  likes: 40,
  replies: 12,
  reposts: 3,
  createdAt: "2026-10-10T10:00:00Z",
  replySettings: "everyone",
  ...over,
});

test("readVerdicts keeps only well-formed keeps", () => {
  const now = Date.parse("2026-10-10T12:00:00Z");
  const far = {
    items: [{ id: "x", keep: true, score: 9, question: "Q by Dec 31?", deadline: "2026-12-31" }],
  };
  assert.equal(readVerdicts(far, now).size, 0, "beyond the ~30-day bet limit");
  const v = readVerdicts(
    {
      items: [
        {
          id: "1",
          keep: true,
          score: 8,
          question: "Will BTC hit $150k by Oct 31?",
          deadline: "2026-10-31",
          category: "crypto",
        },
        { id: "2", keep: false, score: 9, question: "x", deadline: "2026-10-31" },
        { id: "3", keep: true, score: 7, question: "No date", deadline: "soon" },
        {
          id: "4",
          keep: true,
          score: 99,
          question: "Will it rain?",
          deadline: "2026-10-12",
          category: "memes",
        },
      ],
    },
    now,
  );
  assert.deepEqual([...v.keys()], ["1", "4"]);
  assert.equal(v.get("4")!.score, 10, "clamped");
  assert.equal(v.get("4")!.category, null, "unknown category dropped");
  assert.equal(readVerdicts(null).size, 0);
});

test("rank: Claude's score first, then buzz and reach", () => {
  const quiet = rankOf({ score: 8 }, { likes: 0, replies: 0, reposts: 0, followers: 10 });
  const loud = rankOf({ score: 8 }, { likes: 500, replies: 200, reposts: 50, followers: 50_000 });
  const dull = rankOf({ score: 3 }, { likes: 500, replies: 200, reposts: 50, followers: 50_000 });
  assert.ok(loud > quiet && quiet > dull - 40);
});

test("candidate: reply text the bot understands, link to the post", () => {
  const c = toCandidate(
    post(),
    {
      keep: true,
      score: 8,
      question: "Will BTC hit $150k by Oct 31?",
      deadline: "2026-10-31",
      category: "crypto",
    },
    "@oraclexbot",
    1,
  );
  assert.equal(c.reply, "@oraclexbot bet? by Oct 31");
  assert.equal(c.url, "https://x.com/hodler/status/1");
});

test("mergeList: newest copy wins, drops > 3 days, ranks", () => {
  const now = 10 * 86_400_000;
  const c = (id: string, rank: number, foundAt: number) => ({ id, rank, foundAt }) as Candidate;
  const out = mergeList(
    [c("a", 50, now - 4 * 86_400_000), c("b", 10, now)],
    [c("b", 70, now), c("c", 30, now)],
    now,
  );
  assert.deepEqual(
    out.map((x) => `${x.id}:${x.rank}`),
    ["b:70", "c:30"],
  );
});
