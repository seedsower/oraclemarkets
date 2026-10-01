import { formatCents, formatClosesIn, legLabel } from "@pm-amm/sdk/math";

/**
 * Reply copy, built from the keeper's Redis snapshot (`cache:markets` /
 * `cache:groups`, rows = the SDK's MarketView / GroupView). Only the fields
 * used here are typed. Pure — unit-tested without X or Redis.
 */
export interface MarketRow {
  publicKey: string;
  marketId: number;
  authority: string;
  name: string;
  price: number;
  endTs: number;
  resolved: boolean;
  winningSide: number;
  group: string;
  lZero: number;
}

export interface GroupRow {
  groupId: number;
  authority: string;
  name: string;
  endTs: number;
  resolved: boolean;
  legs: (MarketRow | null)[];
}

export type Found = { kind: "market"; m: MarketRow } | { kind: "group"; g: GroupRow };

/** X counts any URL as 23 chars; keep the text part well under 280. */
const MAX_TEXT = 240;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

const STOP = new Set([
  "will",
  "the",
  "a",
  "an",
  "of",
  "on",
  "in",
  "by",
  "to",
  "be",
  "is",
  "at",
  "for",
  "odds",
]);

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9$]+/)
    .filter((t) => t.length >= 2 && !STOP.has(t));
}

function score(name: string, q: string[]): number {
  if (!q.length) return 0;
  const hay = new Set(tokens(name));
  return q.filter((t) => hay.has(t)).length / q.length;
}

/** By numeric market/group id, else best word match (≥ half the words). */
export function findMarket(
  query: string,
  markets: MarketRow[],
  groups: GroupRow[],
  isFeatured: (authority: string) => boolean,
  now: number,
): Found | null {
  const id = query.trim();
  if (/^\d{1,16}$/.test(id)) {
    const m = markets.find((x) => String(x.marketId) === id);
    if (m) return { kind: "market", m };
    const g = groups.find((x) => String(x.groupId) === id);
    return g ? { kind: "group", g } : null;
  }
  const q = tokens(query);
  const live = (end: number, resolved: boolean) => (!resolved && end > now ? 1 : 0);
  const candidates: { f: Found; s: number; rank: number[] }[] = [
    ...markets
      .filter((m) => !m.group)
      .map((m) => ({
        f: { kind: "market" as const, m },
        s: score(m.name, q),
        rank: [live(m.endTs, m.resolved), +isFeatured(m.authority), m.lZero],
      })),
    ...groups.map((g) => ({
      f: { kind: "group" as const, g },
      s: score(g.name, q),
      rank: [live(g.endTs, g.resolved), +isFeatured(g.authority), 0],
    })),
  ].filter((c) => c.s >= 0.5);
  candidates.sort(
    (a, b) =>
      b.s - a.s || b.rank[0]! - a.rank[0]! || b.rank[1]! - a.rank[1]! || b.rank[2]! - a.rank[2]!,
  );
  return candidates[0]?.f ?? null;
}

function marketLine(m: MarketRow, now: number): string {
  if (m.resolved)
    return m.winningSide === 1
      ? "Resolved: YES"
      : m.winningSide === 2
        ? "Resolved: NO"
        : "Resolved";
  return `YES ${formatCents(m.price)} · NO ${formatCents(1 - m.price)} · ${formatClosesIn(m.endTs, now)}`;
}

function groupLine(g: GroupRow, now: number): string {
  const top = g.legs
    .filter((l): l is MarketRow => l !== null)
    .sort((a, b) => b.price - a.price)
    .slice(0, 3)
    .map((l) => `${clip(legLabel(l.name), 18)} ${formatCents(l.price)}`);
  return [...top, g.resolved ? "resolved" : formatClosesIn(g.endTs, now)].join(" · ");
}

export function oddsReply(f: Found, site: string, now: number): string {
  if (f.kind === "market") {
    const line = marketLine(f.m, now);
    return `${clip(f.m.name, MAX_TEXT - line.length - 2)}\n${line}\n${site}/market/${f.m.marketId}`;
  }
  const line = groupLine(f.g, now);
  return `${clip(f.g.name, MAX_TEXT - line.length - 2)}\n${line}\n${site}/group/${f.g.groupId}`;
}

export function notFoundReply(query: string, site: string): string {
  return `No market matches "${clip(query, 60)}" yet. Here's what's live: ${site}/markets?ref=x`;
}

/**
 * Top 3 active featured markets (all live markets when none are featured).
 * Ranked by pool depth (L₀): the keeper doesn't track 24h volume yet.
 */
export function marketsReply(
  markets: MarketRow[],
  isFeatured: (authority: string) => boolean,
  site: string,
  now: number,
): string {
  const live = markets.filter((m) => !m.group && !m.resolved && m.endTs > now);
  const featured = live.filter((m) => isFeatured(m.authority));
  const top = (featured.length ? featured : live).sort((a, b) => b.lZero - a.lZero).slice(0, 3);
  const lines = top.map((m) => `• ${clip(m.name, 52)} YES ${formatCents(m.price)}`);
  const head = top.length ? "Trending on Oracle Markets:" : "Markets on Oracle Markets:";
  return `${[head, ...lines].join("\n")}\n${site}/markets?ref=x`;
}

export const PROPOSE_REPLY = "Noted — if we list it, we'll tag you.";
