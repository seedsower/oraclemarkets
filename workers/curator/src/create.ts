/**
 * Phase 2 market creation, idempotent per partner question.
 *
 * Order for one question:
 *   1. linked (ai:link:question:<id>) or already pending → skip
 *   2. pick a random market id whose PDA is free; record it in curator:pending
 *   3. send initialize_market + deposit_liquidity in ONE transaction (SDK
 *      createMarket), so a market can't exist unseeded
 *   4. write link, reverse link, meta, source tag, category, featured; clear pending
 * reconcile() finishes step 4 for any pending record whose market exists (a crash
 * after confirm), and drops records whose transaction never landed.
 */
import { PublicKey } from "@solana/web3.js";
import { randomU48 } from "@pm-amm/sdk";
import { K, SOURCE } from "./keys";
import type { Plan } from "./plan";

/** The Redis commands used (ioredis-compatible). */
export interface Kv {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
  hget(key: string, field: string): Promise<string | null>;
  hset(key: string, field: string, value: string): Promise<unknown>;
  hdel(key: string, field: string): Promise<unknown>;
  hgetall(key: string): Promise<Record<string, string>>;
  sadd(key: string, member: string): Promise<unknown>;
}

/** The SDK client surface used. */
export interface Chain {
  marketPda(id: number): PublicKey;
  fetchMarket(pk: PublicKey): Promise<unknown | null>;
  send: {
    createMarket(input: {
      name: string;
      durationSecs: number;
      initialPriceBps: number;
      depositUsdc: number;
      marketId: number;
    }): Promise<{ marketId: number; marketPda: string; signature: string }>;
  };
}

export interface Deps {
  kv: Kv;
  chain: Chain;
  now?: () => Date;
  newId?: () => number;
}

interface Pending {
  marketId: number;
  market: string;
  at: string;
  plan: Plan;
}

export type Outcome =
  | { status: "created"; market: string; signature: string; marketId: number }
  | { status: "linked" | "pending"; market: string }
  | { status: "failed"; error: string };

/** Drop a pending record only after its transaction can no longer land. */
export const PENDING_EXPIRY_MS = 15 * 60_000;

/** Every off-chain record for a created market; clears the pending entry last. */
export async function finalize(kv: Kv, plan: Plan, market: string): Promise<void> {
  await kv.set(K.link(plan.questionId), market);
  await kv.set(K.linkMarket(market), plan.questionId);
  await kv.set(K.meta(market), JSON.stringify(plan.meta));
  await kv.hset(K.source, market, SOURCE);
  if (plan.category) await kv.hset(K.categories, market, plan.category);
  await kv.sadd(K.featured, market);
  await kv.hdel(K.pending, plan.questionId);
}

/** Finish or drop pending creations left by an earlier run. */
export async function reconcile(d: Deps): Promise<{ finished: string[]; dropped: string[] }> {
  const now = (d.now ?? (() => new Date()))().getTime();
  const finished: string[] = [];
  const dropped: string[] = [];
  for (const [qid, raw] of Object.entries(await d.kv.hgetall(K.pending))) {
    const p = JSON.parse(raw) as Pending;
    if (await d.chain.fetchMarket(new PublicKey(p.market)).catch(() => null)) {
      await finalize(d.kv, p.plan, p.market);
      finished.push(qid);
    } else if (now - Date.parse(p.at) > PENDING_EXPIRY_MS) {
      await d.kv.hdel(K.pending, qid);
      dropped.push(qid);
    }
  }
  return { finished, dropped };
}

const alreadyInUse = (e: unknown) => /already in use|AccountAlreadyInUse/i.test(String(e));

/** Create one curated market (see the order above). */
export async function createOne(d: Deps, plan: Plan): Promise<Outcome> {
  const linked = await d.kv.get(K.link(plan.questionId));
  if (linked) return { status: "linked", market: linked };
  const pending = await d.kv.hget(K.pending, plan.questionId);
  if (pending) return { status: "pending", market: (JSON.parse(pending) as Pending).market };
  const now = d.now ?? (() => new Date());
  for (let attempt = 0; attempt < 3; attempt++) {
    const marketId = (d.newId ?? randomU48)();
    const pda = d.chain.marketPda(marketId);
    if (await d.chain.fetchMarket(pda).catch(() => null)) continue;
    const market = pda.toBase58();
    const rec: Pending = { marketId, market, at: now().toISOString(), plan };
    await d.kv.hset(K.pending, plan.questionId, JSON.stringify(rec));
    try {
      const r = await d.chain.send.createMarket({
        name: plan.name,
        durationSecs: plan.endTs - Math.floor(now().getTime() / 1000),
        initialPriceBps: plan.priceBps,
        depositUsdc: plan.seedUsdc,
        marketId,
      });
      await finalize(d.kv, plan, market);
      return { status: "created", market, signature: r.signature, marketId };
    } catch (e) {
      if (alreadyInUse(e)) {
        await d.kv.hdel(K.pending, plan.questionId);
        continue;
      }
      // The transaction may still land: keep the pending record for reconcile().
      return { status: "failed", error: e instanceof Error ? e.message : String(e) };
    }
  }
  return { status: "failed", error: "no free market id after 3 tries" };
}
