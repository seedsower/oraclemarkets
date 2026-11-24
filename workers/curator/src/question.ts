/**
 * A partner question, normalized from `get_prediction` (see Phase 0 samples in
 * scripts/partner-mcp-samples/). Pure: no I/O.
 */
export const PARTNER_CATEGORIES = [
  "Politics",
  "Finance",
  "Economics",
  "Geopolitics",
  "Culture",
  "Business",
  "Sports",
  "Climate",
  "Technology",
  "Science",
  "Crypto",
  "Other",
] as const;

/** Partner question page; `{slug}` is replaced. Unverified guess → override via env. */
export const PARTNER_URL_TEMPLATE =
  process.env.CURATOR_PARTNER_URL_TEMPLATE ?? "https://oraclemarkets.io/predictions/{slug}";

/** Ids the partner imported from a real-money venue carry its name as a prefix. */
const VENUE_PREFIX = /^fb-(polymarket|kalshi)-/i;

export interface Question {
  id: string;
  /** Short display title (often ≤ 64 bytes). */
  title: string;
  /** Full question text. */
  text: string;
  category: string;
  status: string;
  /** Partner close, read as 00:00 UTC of `end_date` (the earliest reading). */
  closeAt: Date | null;
  criteria: string;
  url: string;
  /** Number of outcomes: 1 = binary yes/no, more = multiple choice. */
  outcomes: number;
  /** AI consensus P(yes) in [0, 1] for a binary question, else null. */
  p: number | null;
  agentCount: number;
  updatedAt: Date | null;
  /** Mirrors a Polymarket / Kalshi market. */
  venue: boolean;
  /** Position in today's site-wide trending list (1 = most clicked), else null. */
  trendingRank: number | null;
}

type Obj = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const date = (v: unknown): Date | null => {
  const d = typeof v === "string" && v ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};

/** `get_prediction` result (structuredContent or its JSON text) → Question, or null. */
export function fromPrediction(raw: unknown, trendingRank: number | null = null): Question | null {
  const body = unwrap(raw);
  const q = body?.question as Obj | undefined;
  if (!q || !str(q.id)) return null;
  const consensus = (body?.consensus ?? {}) as Obj;
  const outs = Array.isArray(consensus.outcomes) ? (consensus.outcomes as Obj[]) : [];
  const first = outs[0];
  const pct = typeof first?.consensus_p_yes === "number" ? first.consensus_p_yes : null;
  const endDate = str(q.end_date);
  const slug = str(q.slug) || str(q.id);
  return {
    id: str(q.id),
    title: str(q.display_title) || str(q.question_text),
    text: str(q.question_text) || str(q.display_title),
    category: str(q.category),
    status: str(q.status),
    closeAt: /^\d{4}-\d{2}-\d{2}$/.test(endDate) ? date(`${endDate}T00:00:00Z`) : date(endDate),
    criteria: str(q.resolution_criteria),
    url: PARTNER_URL_TEMPLATE.replace("{slug}", encodeURIComponent(slug)),
    outcomes: outs.length,
    p: outs.length === 1 && pct !== null ? Math.min(1, Math.max(0, pct / 100)) : null,
    agentCount: typeof first?.agent_count === "number" ? first.agent_count : 0,
    updatedAt: date(consensus.last_updated),
    venue: VENUE_PREFIX.test(str(q.id)),
    trendingRank,
  };
}

/** structuredContent, else the first JSON text block. */
export function unwrap(raw: unknown): Obj | null {
  const r = raw as { structuredContent?: unknown; content?: { type: string; text?: string }[] };
  if (r?.structuredContent && typeof r.structuredContent === "object")
    return r.structuredContent as Obj;
  for (const c of r?.content ?? []) {
    if (c.type !== "text" || !c.text) continue;
    try {
      const v = JSON.parse(c.text) as unknown;
      if (v && typeof v === "object") return v as Obj;
    } catch {
      // prose
    }
  }
  return null;
}
