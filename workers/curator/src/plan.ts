/**
 * Phase 2 planning (pure): selected question → the exact market to create.
 */
import { SOURCE } from "./keys";
import type { Selected } from "./select";

export interface CreateConfig {
  /** Trading stops this long before the partner's close. */
  closeBufferHours: number;
  seedUsdc: number;
  minPriceBps: number;
  maxPriceBps: number;
  maxNewPerRun: number;
  dryRun: boolean;
}

const num = (v: string | undefined, d: number): number => {
  const n = v === undefined || v === "" ? NaN : Number(v);
  return Number.isFinite(n) ? n : d;
};

export function loadCreateConfig(
  env: Record<string, string | undefined> = process.env,
): CreateConfig {
  return {
    closeBufferHours: num(env.CURATOR_CLOSE_BUFFER_HOURS, 24),
    seedUsdc: num(env.CURATOR_SEED_USDC, 50),
    minPriceBps: 500,
    maxPriceBps: 9500,
    maxNewPerRun: Math.max(0, Math.floor(num(env.CURATOR_MAX_NEW_PER_RUN, 40))),
    // Anything but an explicit "false" is a dry run.
    dryRun: (env.CURATOR_DRY_RUN ?? "true").trim().toLowerCase() !== "false",
  };
}

/** Partner category → the app's category slug (app/src/lib/categories.ts); null = none. */
export const CATEGORY_SLUG: Record<string, string | null> = {
  Politics: "politics",
  Geopolitics: "politics",
  Finance: "finance",
  Economics: "finance",
  Business: "finance",
  Crypto: "crypto",
  Sports: "sports",
  Culture: "culture",
  Climate: "weather",
  Science: "science",
  Technology: "science",
  Other: null,
};

export const ATTRIBUTION = "Question and AI line by oraclemarkets.io";

/** Shown on the market page (Redis market:meta:<pubkey>). */
export interface MarketMeta {
  source: typeof SOURCE;
  attribution: string;
  questionId: string;
  /** Full partner title and question text (the on-chain name may be shortened). */
  title: string;
  question: string;
  criteria: string;
  url: string;
  partnerCategory: string;
  /** AI consensus P(yes) when the market was opened, and when the partner computed it. */
  consensus: number;
  consensusAt: string | null;
  partnerClose: string | null;
  curatedAt: string;
}

export interface Plan {
  questionId: string;
  name: string;
  endTs: number;
  priceBps: number;
  seedUsdc: number;
  category: string | null;
  meta: MarketMeta;
}

/** Contract minimum is 300 s; keep a margin for a run that sits in a queue. */
export const MIN_LEAD_SECS = 3_600;

export const priceBps = (p: number, cfg: Pick<CreateConfig, "minPriceBps" | "maxPriceBps">) =>
  Math.min(cfg.maxPriceBps, Math.max(cfg.minPriceBps, Math.round(p * 10_000)));

/** Partner close − buffer, in unix seconds. */
export const endTsFor = (closeAt: Date, bufferHours: number) =>
  Math.floor(closeAt.getTime() / 1000 - bufferHours * 3600);

export function planFor(s: Selected, cfg: CreateConfig, now = new Date()): Plan | { skip: string } {
  const q = s.question;
  if (!q.closeAt || q.p === null) return { skip: "no close date or consensus" };
  const endTs = endTsFor(q.closeAt, cfg.closeBufferHours);
  if (endTs - Math.floor(now.getTime() / 1000) < MIN_LEAD_SECS)
    return { skip: "deadline (close − buffer) too close" };
  return {
    questionId: q.id,
    name: s.title,
    endTs,
    priceBps: priceBps(q.p, cfg),
    seedUsdc: cfg.seedUsdc,
    category: CATEGORY_SLUG[q.category] ?? null,
    meta: {
      source: SOURCE,
      attribution: ATTRIBUTION,
      questionId: q.id,
      title: q.title,
      question: q.text,
      criteria: q.criteria,
      url: q.url,
      partnerCategory: q.category,
      consensus: q.p,
      consensusAt: q.updatedAt?.toISOString() ?? null,
      partnerClose: q.closeAt.toISOString(),
      curatedAt: now.toISOString(),
    },
  };
}

/** Interleave categories (1st of each, then 2nd of each…) so no category eats the budget. */
export function roundRobin<T>(byCategory: Record<string, T[]>): T[] {
  const lists = Object.values(byCategory);
  const out: T[] = [];
  for (let i = 0; lists.some((l) => i < l.length); i++)
    for (const l of lists) if (i < l.length) out.push(l[i]!);
  return out;
}
