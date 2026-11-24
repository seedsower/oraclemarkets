import { redis } from "@/lib/redis";
import { isAccount } from "@/lib/server/art";

/**
 * Off-chain details of a curated market (written by workers/curator, Redis
 * `market:meta:<pubkey>`): the partner's full question, resolution criteria
 * and link, shown with attribution. Only these whitelisted fields leave the
 * server, as plain strings / numbers.
 */
export interface MarketMeta {
  source: string;
  attribution: string;
  title: string;
  question: string;
  criteria: string;
  url: string;
  partnerCategory: string;
  consensus: number | null;
  consensusAt: string | null;
}

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");

/** Only https links to the partner's own site are passed through. */
function safeUrl(v: unknown): string {
  try {
    const u = new URL(String(v));
    return u.protocol === "https:" && /(^|\.)oraclemarkets\.io$/.test(u.hostname) ? u.href : "";
  } catch {
    return "";
  }
}

export async function getMarketMeta(account: string): Promise<MarketMeta | null> {
  if (!redis || !isAccount(account)) return null;
  let raw: string | null;
  try {
    raw = await redis.get(`market:meta:${account}`);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const m = JSON.parse(raw) as Record<string, unknown>;
    const p =
      typeof m.consensus === "number" && m.consensus >= 0 && m.consensus <= 1 ? m.consensus : null;
    return {
      source: str(m.source, 64),
      attribution: str(m.attribution, 120),
      title: str(m.title, 300),
      question: str(m.question, 600),
      criteria: str(m.criteria, 4000),
      url: safeUrl(m.url),
      partnerCategory: str(m.partnerCategory, 40),
      consensus: p,
      consensusAt: str(m.consensusAt, 40) || null,
    };
  } catch {
    return null;
  }
}
