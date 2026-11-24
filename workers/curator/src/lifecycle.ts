/**
 * Phase 4: lifecycle of curated markets (markets can't be deleted on-chain).
 *
 * Each run, for every curated market (Redis market:source):
 *   - resolved on-chain            → drop the featured mark and any review entry
 *   - partner question still active → refresh the AI line in market:meta, re-apply the
 *                                     category, featured = still in its category's top N
 *   - partner resolved / void / gone → a review entry in curator:review for a human
 *                                     (the curator NEVER resolves; the resolver signs in /admin)
 *
 * The partner's tools only return active questions, so "gone" (no longer returned)
 * usually means resolved, voided or made private: the entry says to check the partner page.
 */
import type { PublicKey } from "@solana/web3.js";
import { K } from "./keys";
import { CATEGORY_SLUG } from "./plan";
import type { Question } from "./question";

export const REVIEW_KEY = "curator:review";

export interface ReviewItem {
  market: string;
  questionId: string;
  kind: "partner-resolved" | "partner-void" | "partner-gone";
  note: string;
  url: string;
  at: string;
}

/** A partner lookup: the question if it was returned, else why not. */
export interface Lookup {
  question: Question | null;
  error?: string;
}

/** What to tell the resolver about a lookup, or null when the question is still active. */
export function reviewFor(
  market: string,
  questionId: string,
  url: string,
  look: Lookup,
  now: Date,
): ReviewItem | null {
  const status = look.question?.status.toLowerCase() ?? "";
  if (look.question && status === "active") return null;
  const at = now.toISOString();
  const day = at.slice(0, 10);
  if (status === "resolved")
    return {
      market,
      questionId,
      kind: "partner-resolved",
      note: `Partner marked the question resolved (seen ${day}); check the outcome at the source before resolving.`,
      url,
      at,
    };
  if (status === "void" || status === "voided" || status === "cancelled")
    return {
      market,
      questionId,
      kind: "partner-void",
      note: `Partner voided the question (seen ${day}): needs a human decision.`,
      url,
      at,
    };
  return {
    market,
    questionId,
    kind: "partner-gone",
    note:
      `Partner no longer lists the question as active (seen ${day}${status ? `, status ${status}` : ""}` +
      `${look.error ? `, ${look.error.slice(0, 120)}` : ""}): probably resolved or voided — check the source.`,
    url,
    at,
  };
}

export interface LifecycleKv {
  hkeys(key: string): Promise<string[]>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
  hset(key: string, field: string, value: string): Promise<unknown>;
  hsetnx(key: string, field: string, value: string): Promise<unknown>;
  hdel(key: string, field: string): Promise<unknown>;
  sadd(key: string, member: string): Promise<unknown>;
  srem(key: string, member: string): Promise<unknown>;
}

export interface LifecycleDeps {
  kv: LifecycleKv;
  fetchMarket(pk: PublicKey): Promise<{ resolved?: boolean } | null>;
  toKey(s: string): PublicKey;
  /** Partner lookup for a question not in this run's pool; null = couldn't tell (skip it). */
  lookup(questionId: string): Promise<Lookup | null>;
  now?: () => Date;
}

export interface LifecycleReport {
  refreshed: number;
  featured: number;
  unfeatured: number;
  review: ReviewItem[];
  resolved: number;
}

/** Fresh AI line + timestamps merged into the stored meta. */
async function refreshMeta(kv: LifecycleKv, market: string, q: Question, now: Date) {
  const meta = JSON.parse((await kv.get(K.meta(market))) ?? "{}") as Record<string, unknown>;
  meta.aiNow = q.p;
  meta.aiNowAt = q.updatedAt?.toISOString() ?? null;
  meta.refreshedAt = now.toISOString();
  await kv.set(K.meta(market), JSON.stringify(meta));
  const slug = CATEGORY_SLUG[q.category];
  if (slug) await kv.hset(K.categories, market, slug);
}

/** One pass over every curated market. `selected` = question ids in this run's top N. */
export async function refreshCurated(
  d: LifecycleDeps,
  selected: Set<string>,
  pool: Map<string, Question>,
): Promise<LifecycleReport> {
  const now = (d.now ?? (() => new Date()))();
  const r: LifecycleReport = { refreshed: 0, featured: 0, unfeatured: 0, review: [], resolved: 0 };
  for (const market of await d.kv.hkeys(K.source)) {
    const qid = await d.kv.get(K.linkMarket(market));
    if (!qid) continue;
    const onChain = await d.fetchMarket(d.toKey(market)).catch(() => null);
    if (onChain?.resolved) {
      await d.kv.srem(K.featured, market);
      await d.kv.hdel(REVIEW_KEY, market);
      r.resolved++;
      continue;
    }
    const pooled = pool.get(qid);
    const look = pooled ? { question: pooled } : await d.lookup(qid);
    if (!look) continue; // transport error or call cap: change nothing this run
    const meta = JSON.parse((await d.kv.get(K.meta(market))) ?? "{}") as { url?: string };
    const item = reviewFor(market, qid, meta.url ?? "", look, now);
    if (item) {
      await d.kv.srem(K.featured, market);
      // first sighting wins: keeps the date the partner dropped it
      await d.kv.hsetnx(REVIEW_KEY, market, JSON.stringify(item));
      r.review.push(item);
      continue;
    }
    await refreshMeta(d.kv, market, look.question!, now);
    await d.kv.hdel(REVIEW_KEY, market); // active again: drop a stale entry
    r.refreshed++;
    if (selected.has(qid)) {
      await d.kv.sadd(K.featured, market);
      r.featured++;
    } else {
      await d.kv.srem(K.featured, market);
      r.unfeatured++;
    }
  }
  return r;
}
