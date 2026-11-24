/**
 * Phase 6: one report per run in Redis (the last 30), read by /admin.
 *
 *   curator:runs           sorted set: report key, scored by run start (ms)
 *   curator:runs:<ms>      JSON RunReport
 *   curator:next-run-dry   "1" when the next run was requested as a dry-run preview (keeper sets it)
 *   curator:announcements  list of JSON Announcement for the xbot (only if CURATOR_ANNOUNCE_ON_X=true)
 */
export const RUNS_KEY = "curator:runs";
export const KEEP_RUNS = 30;
export const PREVIEW_KEY = "curator:next-run-dry";
export const ANNOUNCE_KEY = "curator:announcements";

export interface ReportRow {
  questionId: string;
  category: string;
  name: string;
  result: string;
  market?: string;
  priceBps?: number;
  signature?: string;
}

export interface RunReport {
  at: string;
  finishedAt: string;
  dryRun: boolean;
  /** "schedule" or "preview" (a dry run requested from /admin). */
  trigger: string;
  budget: { allowed: number; limitedBy: string; limits: Record<string, number> } | null;
  seedUsdc: number;
  selected: Record<
    string,
    { questionId: string; title: string; p: number | null; score: number }[]
  >;
  rows: ReportRow[];
  /** Selection skip reasons, grouped (numbers replaced by #) → count. */
  skips: Record<string, number>;
  lifecycle: {
    refreshed: number;
    featured: number;
    unfeatured: number;
    resolved: number;
    review: number;
  } | null;
  mcpCalls: number;
  errors: string[];
  summary: {
    created: number;
    wouldCreate: number;
    failed: number;
    linked: number;
    overBudget: number;
  };
}

/** Group "closes in 2.5 d (< 3)" and "closes in 1.0 d (< 3)" together. */
export function groupSkips(skips: { reason: string }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of skips) {
    const k = s.reason.replace(/-?\d+(\.\d+)?/g, "#").replace(/\("[^"]*"\)/, '("…")');
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

export function summarize(rows: ReportRow[]): RunReport["summary"] {
  const n = (p: (r: ReportRow) => boolean) => rows.filter(p).length;
  return {
    created: n((r) => r.result === "created"),
    wouldCreate: n((r) => r.result === "would create"),
    failed: n((r) => r.result.startsWith("failed")),
    linked: n((r) => r.result === "already linked" || r.result === "linked"),
    overBudget: n((r) => r.result.startsWith("over budget")),
  };
}

export interface ReportKv {
  set(key: string, value: string): Promise<unknown>;
  zadd(key: string, score: number, member: string): Promise<unknown>;
  zrange(key: string, start: number, stop: string): Promise<string[]>;
  zrem(key: string, member: string): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

/** Store the report and drop all but the newest KEEP_RUNS. */
export async function saveReport(
  kv: ReportKv,
  startedMs: number,
  report: RunReport,
): Promise<string> {
  const key = `${RUNS_KEY}:${startedMs}`;
  await kv.set(key, JSON.stringify(report));
  await kv.zadd(RUNS_KEY, startedMs, key);
  const old = await kv.zrange(RUNS_KEY, 0, String(-(KEEP_RUNS + 1)));
  for (const k of old) {
    await kv.del(k);
    await kv.zrem(RUNS_KEY, k);
  }
  return key;
}

/** What the xbot posts after a live run that created markets. */
export interface Announcement {
  count: number;
  titles: string[];
  at: string;
}

export function announcementFor(report: RunReport): Announcement | null {
  const created = report.rows.filter((r) => r.result === "created");
  if (report.dryRun || created.length === 0) return null;
  return {
    count: created.length,
    titles: created.slice(0, 3).map((r) => r.name),
    at: report.finishedAt,
  };
}
