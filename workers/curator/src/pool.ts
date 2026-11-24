/**
 * Candidate pool from the partner MCP (read-only tools only).
 *
 * The partner has no category filter and no list-all (Phase 0), so the pool is:
 * today's trending list + keyword searches per category (limit 50 each), then
 * `get_prediction` for every id that passes the cheap checks the search result
 * already allows (category, status, close-date window). Calls are rate-limited,
 * retried with exponential backoff and capped per run.
 */
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { fromPrediction, unwrap, type Question } from "./question";
import type { CuratorConfig } from "./select";

/** Search terms per partner category (keyword search, not a category filter). */
export const CATEGORY_QUERIES: Record<string, string[]> = {
  Politics: ["election", "president", "prime minister", "senate", "parliament", "referendum"],
  Finance: ["stock", "S&P", "Nasdaq", "return", "shares", "market cap"],
  Economics: ["inflation", "interest rate", "GDP", "unemployment", "Fed", "ECB", "CPI"],
  Geopolitics: ["ceasefire", "NATO", "sanctions", "China", "Russia", "treaty"],
  Culture: ["film", "album", "Oscar", "Grammy", "box office", "music", "streaming"],
  Business: ["IPO", "CEO", "earnings", "merger", "acquisition", "revenue"],
  Sports: ["championship", "World Cup", "NBA", "NFL", "league", "Olympics", "Super Bowl"],
  Climate: ["temperature", "climate", "emissions", "hurricane", "snow", "warmest"],
  Technology: ["AI", "OpenAI", "Apple", "launch", "chip", "Tesla"],
  Science: ["NASA", "space", "vaccine", "Mars", "fusion", "discovery"],
  Crypto: ["bitcoin", "ethereum", "solana", "crypto", "ETF", "stablecoin"],
  Other: ["2026", "2027"],
};

export interface PoolOptions {
  maxCalls: number;
  minIntervalMs: number;
  now?: Date;
  log?: (msg: string) => void;
}

export interface Pool {
  questions: Question[];
  calls: number;
  errors: string[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Rate-limited, capped, retrying callTool. Throws "MCP call cap reached". */
export function makeCaller(client: Pick<Client, "callTool">, o: PoolOptions) {
  let calls = 0;
  let last = 0;
  const call = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
    for (let attempt = 0; ; attempt++) {
      if (calls >= o.maxCalls) throw new Error("MCP call cap reached");
      const wait = last + o.minIntervalMs - Date.now();
      if (wait > 0) await sleep(wait);
      calls++;
      last = Date.now();
      try {
        const res = (await client.callTool({ name, arguments: args })) as { isError?: boolean };
        if (res?.isError) throw new Error(JSON.stringify(res).slice(0, 200));
        return res;
      } catch (e) {
        if (attempt >= 2) throw e;
        await sleep(o.minIntervalMs * 2 ** (attempt + 1));
      }
    }
  };
  return { call, count: () => calls };
}

interface Hit {
  id: string;
  category: string;
  status: string;
  end: string;
  rank: number | null;
}

/** Rows of a search / trending result → hits. */
export function hitsIn(raw: unknown): Hit[] {
  const body = unwrap(raw) ?? {};
  const rows = (body.results ?? body.trending ?? []) as Record<string, unknown>[];
  return (Array.isArray(rows) ? rows : []).flatMap((r) => {
    const id = String(r.id ?? r.question_id ?? "");
    if (!id) return [];
    return [
      {
        id,
        category: String(r.category ?? ""),
        status: String(r.status ?? "active"),
        end: String(r.end_date ?? ""),
        rank: typeof r.rank === "number" ? r.rank : null,
      },
    ];
  });
}

/** Cheap pre-check on a search hit, so we don't spend a get_prediction on it. */
export function worthFetching(h: Hit, cfg: CuratorConfig, now: Date): boolean {
  if (h.category && !cfg.categories.includes(h.category)) return false;
  if (h.status && h.status !== "active") return false;
  const close = Date.parse(`${h.end}T00:00:00Z`);
  if (Number.isNaN(close)) return true;
  const days = (close - now.getTime()) / 86_400_000;
  return days >= cfg.minDays && days <= cfg.maxDays;
}

/** Trending + per-category searches → unique hits (trending first, rank kept). */
async function collectHits(
  call: (n: string, a: Record<string, unknown>) => Promise<unknown>,
  cfg: CuratorConfig,
  errors: string[],
): Promise<Map<string, Hit>> {
  const hits = new Map<string, Hit>();
  const add = (list: Hit[]) => list.forEach((h) => hits.has(h.id) || hits.set(h.id, h));
  try {
    add(hitsIn(await call("list_trending_questions", {})));
  } catch (e) {
    errors.push(`trending: ${(e as Error).message}`);
  }
  for (const cat of cfg.categories)
    for (const query of CATEGORY_QUERIES[cat] ?? [cat]) {
      try {
        add(hitsIn(await call("search_predictions", { query, limit: 50, status: "active" })));
      } catch (e) {
        errors.push(`search "${query}": ${(e as Error).message}`);
        if ((e as Error).message === "MCP call cap reached") return hits;
      }
    }
  return hits;
}

/** The candidate pool for one run. */
export async function gatherPool(
  client: Pick<Client, "callTool">,
  cfg: CuratorConfig,
  o: PoolOptions,
): Promise<Pool> {
  const now = o.now ?? new Date();
  const { call, count } = makeCaller(client, o);
  const errors: string[] = [];
  const hits = await collectHits(call, cfg, errors);
  const wanted = [...hits.values()].filter((h) => worthFetching(h, cfg, now));
  o.log?.(`${hits.size} unique questions found, ${wanted.length} worth fetching`);
  const questions: Question[] = [];
  for (const h of wanted) {
    try {
      const q = fromPrediction(await call("get_prediction", { question_id: h.id }), h.rank);
      if (q) questions.push(q);
    } catch (e) {
      errors.push(`get ${h.id}: ${(e as Error).message}`);
      if ((e as Error).message === "MCP call cap reached") break;
    }
  }
  return { questions, calls: count(), errors };
}
