/**
 * Backend-agnostic reply shaping for `KvStore` (see `redis.ts`). Kept free of
 * imports so it can be unit-tested with plain `node --test`.
 */

export interface ScoredMember {
  member: string;
  score: number;
}

/** Members come back as strings from ioredis; Upstash may hand back parsed JSON. */
export function memberToString(raw: unknown): string {
  return typeof raw === "string" ? raw : JSON.stringify(raw);
}

function push(out: ScoredMember[], member: unknown, rawScore: unknown): void {
  const score = Number(rawScore);
  if (Number.isFinite(score)) out.push({ member: memberToString(member), score });
}

/**
 * `ZRANGE … WITHSCORES` as `[{ member, score }]`. Over RESP2, ioredis returns a
 * flat `[member, score, member, score, …]` array of strings; Upstash returns the
 * same flat layout with numeric scores and possibly deserialized members. Over
 * RESP3 the reply is nested `[[member, score], …]` — accepted too.
 */
export function pairsFromFlat(flat: readonly unknown[]): ScoredMember[] {
  const out: ScoredMember[] = [];
  if (flat.length > 0 && Array.isArray(flat[0])) {
    for (const pair of flat as readonly unknown[][]) push(out, pair[0], pair[1]);
    return out;
  }
  for (let i = 0; i + 1 < flat.length; i += 2) push(out, flat[i], flat[i + 1]);
  return out;
}

/** Numeric reply that may arrive as a string (`"3"`) or number. */
export function toInt(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}
