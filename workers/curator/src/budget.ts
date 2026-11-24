/**
 * Phase 3 budgets and the run lock. Everything is checked BEFORE any
 * transaction: the run creates at most `allowance()` markets (in the existing
 * round-robin order), reports the rest with the limit that stopped them, and
 * exits 0.
 */
import type { PublicKey } from "@solana/web3.js";
import { K } from "./keys";

export interface BudgetConfig {
  /** Seed in unresolved curated markets + this run's seeds must stay below this. */
  maxOpenSeedUsdc: number;
  /** SOL to keep on the curator wallet after the run. */
  minSol: number;
  /** Estimated SOL per market (rent for the market, mints, vault + fees; measured ≈ 0.035). */
  solPerMarket: number;
}

const num = (v: string | undefined, d: number): number => {
  const n = v === undefined || v === "" ? NaN : Number(v);
  return Number.isFinite(n) ? n : d;
};

export function loadBudgetConfig(
  env: Record<string, string | undefined> = process.env,
): BudgetConfig {
  return {
    maxOpenSeedUsdc: num(env.CURATOR_MAX_OPEN_SEED_USDC, 3000),
    minSol: num(env.CURATOR_MIN_SOL, 0.5),
    solPerMarket: num(env.CURATOR_SOL_PER_MARKET, 0.05),
  };
}

export interface BudgetInput {
  maxNewPerRun: number;
  seedUsdc: number;
  openSeedUsdc: number;
  usdc: number;
  sol: number;
}

export interface Allowance {
  allowed: number;
  /** The tightest limit, for the report. */
  limitedBy: string;
  limits: Record<string, number>;
}

/** How many markets this run may create (the minimum over every limit). */
export function allowance(b: BudgetInput, cfg: BudgetConfig): Allowance {
  const per = (amount: number, each: number) =>
    each > 0 ? Math.max(0, Math.floor(amount / each + 1e-9)) : Infinity;
  // "must stay below" the cap → strictly less than: leave one micro-USDC of room
  const capRoom = cfg.maxOpenSeedUsdc - b.openSeedUsdc - 1e-6;
  const limits: Record<string, number> = {
    CURATOR_MAX_NEW_PER_RUN: b.maxNewPerRun,
    CURATOR_MAX_OPEN_SEED_USDC: per(capRoom, b.seedUsdc),
    "USDC balance": per(b.usdc, b.seedUsdc),
    CURATOR_MIN_SOL: per(b.sol - cfg.minSol, cfg.solPerMarket),
  };
  let limitedBy = "CURATOR_MAX_NEW_PER_RUN";
  for (const [k, v] of Object.entries(limits)) if (v < limits[limitedBy]!) limitedBy = k;
  return { allowed: Math.max(0, limits[limitedBy]!), limitedBy, limits };
}

/** Read side: Redis (curated markets) + chain (resolved? balances). */
export interface BudgetKv {
  hkeys(key: string): Promise<string[]>;
  get(key: string): Promise<string | null>;
}
export interface BudgetChain {
  fetchMarket(pk: PublicKey): Promise<{ resolved?: boolean } | null>;
}

/** Seed (USDC) in curated markets that aren't resolved yet. */
export async function openSeed(
  kv: BudgetKv,
  chain: BudgetChain,
  toKey: (s: string) => PublicKey,
  fallbackSeed: number,
): Promise<number> {
  let total = 0;
  for (const market of await kv.hkeys(K.source)) {
    const m = await chain.fetchMarket(toKey(market)).catch(() => null);
    if (!m || m.resolved) continue;
    const meta = JSON.parse((await kv.get(K.meta(market))) ?? "{}") as { seedUsdc?: unknown };
    total += typeof meta.seedUsdc === "number" ? meta.seedUsdc : fallbackSeed;
  }
  return total;
}

// ── lock ────────────────────────────────────────────────────────────────────

export const LOCK_KEY = "curator:lock";
export const LOCK_TTL_SECS = 2 * 3600;

export interface LockKv {
  set(key: string, value: string, ex: "EX", secs: number, nx: "NX"): Promise<string | null>;
  eval(script: string, keys: number, ...args: string[]): Promise<unknown>;
}

/** True if this run now holds the lock (2 h TTL, so a crashed run can't block forever). */
export async function acquireLock(kv: LockKv, token: string): Promise<boolean> {
  return (await kv.set(LOCK_KEY, token, "EX", LOCK_TTL_SECS, "NX")) === "OK";
}

/** Delete the lock only if we still own it. */
export async function releaseLock(kv: LockKv, token: string): Promise<void> {
  await kv.eval(
    'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) end return 0',
    1,
    LOCK_KEY,
    token,
  );
}
