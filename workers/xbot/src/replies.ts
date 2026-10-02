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
  // Question words and command synonyms carry no topic.
  "odd",
  "what",
  "are",
  "how",
  "much",
  "does",
  "do",
  "can",
  "price",
  "prices",
  "chance",
  "chances",
  "it",
  "there",
  "any",
  "market",
  "this",
  "that",
  "and",
  "or",
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
  // Word searches skip markets that are closed but not yet resolved: they
  // can't be traded and have no answer yet — a useless reply.
  const answerable = (end: number, resolved: boolean) => resolved || end > now;
  const candidates: { f: Found; s: number; rank: number[] }[] = [
    ...markets
      .filter((m) => !m.group && answerable(m.endTs, m.resolved))
      .map((m) => ({
        f: { kind: "market" as const, m },
        s: score(m.name, q),
        rank: [live(m.endTs, m.resolved), +isFeatured(m.authority), m.lZero],
      })),
    ...groups
      .filter((g) => answerable(g.endTs, g.resolved))
      .map((g) => ({
        f: { kind: "group" as const, g },
        s: score(g.name, q),
        rank: [live(g.endTs, g.resolved), +isFeatured(g.authority), 0],
      })),
  ].filter((c) => c.s >= 0.5);
  // Live (tradable) markets first, then best word match, then featured, then depth.
  candidates.sort(
    (a, b) =>
      b.rank[0]! - a.rank[0]! || b.s - a.s || b.rank[1]! - a.rank[1]! || b.rank[2]! - a.rank[2]!,
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

/** X counts every link as 23 characters, whatever its length. */
const LINK = 23;
const LIMIT = 280;

export function oddsReply(f: Found, site: string, now: number): string {
  if (f.kind === "market") {
    const line = marketLine(f.m, now);
    const url = `${site}/market/${f.m.marketId}`;
    // Tradable → one-tap buy links (open the market with the trade pre-filled).
    if (!f.m.resolved && f.m.endTs > now) {
      const tail = `Buy YES: ${url}?buy=yes&amount=5\nBuy NO: ${url}?buy=no&amount=5`;
      const tailWeight = "Buy YES: ".length + LINK + 1 + "Buy NO: ".length + LINK;
      const room = LIMIT - tailWeight - line.length - 4;
      return `${clip(f.m.name, room)}\n${line}\n${tail}`;
    }
    return `${clip(f.m.name, MAX_TEXT - line.length - 2)}\n${line}\n${url}`;
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

/** A "will …?" question with no matching market: say how to propose it. */
export function proposeHintReply(site: string): string {
  return `No market on that yet. Want it listed? Reply "propose <question> by <date>" — or browse what's live: ${site}/markets?ref=x`;
}
