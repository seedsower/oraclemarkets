/**
 * Phase 1: eligibility + ranking (pure). `selectTop` picks the top N eligible
 * questions per category; every other question gets a skip reason.
 *
 * Ranking: the partner has no per-category ranking (Phase 0), only a site-wide
 * "most clicked today" list. Trending questions come first (by rank), then the
 * computed score, then sooner close, then partner id.
 */
import { PARTNER_CATEGORIES, type Question } from "./question";
import { pickTitle } from "./title";
import { keywordScreen } from "./policy-keywords";

export interface Weights {
  venue: number;
  uncertain: number;
  soon: number;
  fresh: number;
}

export interface CuratorConfig {
  minDays: number;
  maxDays: number;
  /** A forecast older than this is stale. */
  maxAgeHours: number;
  minProb: number;
  maxProb: number;
  categories: string[];
  topN: number;
  weights: Weights;
}

/** The Claude content-policy verdict for one question. */
export interface Verdict {
  ok: boolean;
  reason: string;
}

export interface SelectOptions {
  now?: Date;
  /** Vetted ≤ 64-byte titles by question id (Phase 2). */
  shortTitles?: Map<string, string>;
  verdicts?: Map<string, Verdict>;
  /** Skip questions without a verdict (on for real runs, off for pre-selection). */
  requireVerdict?: boolean;
}

export interface Selected {
  question: Question;
  title: string;
  score: number;
}

export interface Skip {
  id: string;
  category: string;
  reason: string;
}

export interface Selection {
  byCategory: Record<string, Selected[]>;
  selected: Selected[];
  skipped: Skip[];
}

const DAY = 86_400_000;
const num = (v: string | undefined, d: number): number => {
  const n = v === undefined || v === "" ? NaN : Number(v);
  return Number.isFinite(n) ? n : d;
};

/** Config from env (defaults per the spec). */
export function loadConfig(env: Record<string, string | undefined> = process.env): CuratorConfig {
  const cats = (env.CURATOR_CATEGORIES ?? "")
    .split(",")
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean);
  return {
    minDays: num(env.CURATOR_MIN_DAYS, 3),
    maxDays: num(env.CURATOR_MAX_DAYS, 120),
    maxAgeHours: num(env.CURATOR_MAX_FORECAST_AGE_HOURS, 48),
    minProb: num(env.CURATOR_MIN_PROB, 0.05),
    maxProb: num(env.CURATOR_MAX_PROB, 0.95),
    categories: cats.length
      ? PARTNER_CATEGORIES.filter((c) => cats.includes(c.toLowerCase()))
      : [...PARTNER_CATEGORIES],
    topN: Math.max(0, Math.floor(num(env.CURATOR_TOP_N, 10))),
    weights: {
      venue: num(env.CURATOR_W_VENUE, 0.4),
      uncertain: num(env.CURATOR_W_UNCERTAIN, 0.3),
      soon: num(env.CURATOR_W_SOON, 0.2),
      fresh: num(env.CURATOR_W_FRESH, 0.1),
    },
  };
}

/** Why `q` can't be curated, or null. Checks run cheapest first. */
export function skipReason(
  q: Question,
  cfg: CuratorConfig,
  opts: SelectOptions = {},
): string | null {
  const now = (opts.now ?? new Date()).getTime();
  if (!cfg.categories.includes(q.category)) return `category ${q.category || "(none)"} not curated`;
  if (q.status !== "active") return `status ${q.status || "(none)"}`;
  if (!q.criteria) return "no resolution criteria";
  if (q.outcomes !== 1) return `multiple choice (${q.outcomes} options); binary only`;
  if (!q.closeAt) return "no close date";
  const days = (q.closeAt.getTime() - now) / DAY;
  if (days < cfg.minDays) return `closes in ${days.toFixed(1)} d (< ${cfg.minDays})`;
  if (days > cfg.maxDays) return `closes in ${Math.round(days)} d (> ${cfg.maxDays})`;
  if (q.p === null || q.agentCount === 0) return "no AI consensus";
  if (!q.updatedAt) return "no forecast timestamp";
  const ageH = (now - q.updatedAt.getTime()) / 3_600_000;
  if (ageH >= cfg.maxAgeHours) return `forecast ${Math.round(ageH)} h old (≥ ${cfg.maxAgeHours})`;
  if (q.p < cfg.minProb || q.p > cfg.maxProb)
    return `consensus ${Math.round(q.p * 100)}% outside ${cfg.minProb * 100}–${cfg.maxProb * 100}%`;
  if (!pickTitle([opts.shortTitles?.get(q.id), q.title, q.text]))
    return "no title fits 64 bytes (needs a short title)";
  const kw = keywordScreen(q);
  if (kw) return `content policy (keyword): ${kw}`;
  const v = opts.verdicts?.get(q.id);
  if (v && !v.ok) return `content policy: ${v.reason}`;
  if (!v && opts.requireVerdict) return "content policy not checked";
  return null;
}

/** score = w_venue·venue + w_uncertain·(1 − |2p − 1|) + w_soon·(≤ 30 d) + w_fresh·(≤ 24 h). */
export function score(q: Question, w: Weights, now = new Date()): number {
  const t = now.getTime();
  const p = q.p ?? 0.5;
  const soon = q.closeAt ? q.closeAt.getTime() - t <= 30 * DAY : false;
  const fresh = q.updatedAt ? t - q.updatedAt.getTime() <= DAY : false;
  return (
    w.venue * (q.venue ? 1 : 0) +
    w.uncertain * (1 - Math.abs(2 * p - 1)) +
    w.soon * (soon ? 1 : 0) +
    w.fresh * (fresh ? 1 : 0)
  );
}

/** Trending rank first, then score (desc), sooner close, partner id. */
export function compareSelected(a: Selected, b: Selected): number {
  const ra = a.question.trendingRank ?? Infinity;
  const rb = b.question.trendingRank ?? Infinity;
  if (ra !== rb) return ra - rb;
  if (Math.abs(a.score - b.score) > 1e-12) return b.score - a.score;
  const ca = a.question.closeAt?.getTime() ?? Infinity;
  const cb = b.question.closeAt?.getTime() ?? Infinity;
  if (ca !== cb) return ca - cb;
  return a.question.id < b.question.id ? -1 : a.question.id > b.question.id ? 1 : 0;
}

/** Top N eligible questions per category. Duplicate ids keep the first copy. */
export function selectTop(
  questions: Question[],
  cfg: CuratorConfig,
  opts: SelectOptions = {},
): Selection {
  const now = opts.now ?? new Date();
  const seen = new Set<string>();
  const skipped: Skip[] = [];
  const eligible = new Map<string, Selected[]>(cfg.categories.map((c) => [c, []]));
  for (const q of questions) {
    if (seen.has(q.id)) continue;
    seen.add(q.id);
    const reason = skipReason(q, cfg, { ...opts, now });
    if (reason) {
      skipped.push({ id: q.id, category: q.category, reason });
      continue;
    }
    const title = pickTitle([opts.shortTitles?.get(q.id), q.title, q.text])!;
    eligible.get(q.category)!.push({ question: q, title, score: score(q, cfg.weights, now) });
  }
  const byCategory: Record<string, Selected[]> = {};
  for (const [cat, list] of eligible) {
    list.sort(compareSelected);
    byCategory[cat] = list.slice(0, cfg.topN);
    for (const s of list.slice(cfg.topN))
      skipped.push({ id: s.question.id, category: cat, reason: `ranked below top ${cfg.topN}` });
  }
  return { byCategory, selected: Object.values(byCategory).flat(), skipped };
}
