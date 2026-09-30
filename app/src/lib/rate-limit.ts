import { redis, type KvStore } from "@/lib/redis";

/**
 * Fixed-window counter. Backed by Redis when configured (TCP or Upstash —
 * shared across instances); otherwise, or whenever Redis errors, an in-memory
 * Map, which is per-instance and therefore best-effort only — fine for local
 * dev and brief Redis outages, too weak as the only guard on a public deploy.
 */
export interface RateLimitResult {
  ok: boolean;
  /** Seconds until the window resets (0 when ok). */
  retryAfter: number;
}

const memory = new Map<string, { count: number; resetAt: number }>();

async function hitRedis(
  r: KvStore,
  key: string,
  limit: number,
  windowSecs: number,
): Promise<RateLimitResult> {
  const count = await r.incr(key);
  if (count === 1) await r.expire(key, windowSecs);
  if (count <= limit) return { ok: true, retryAfter: 0 };
  const ttl = await r.ttl(key);
  return { ok: false, retryAfter: ttl > 0 ? ttl : windowSecs };
}

function hitMemory(key: string, limit: number, windowSecs: number): RateLimitResult {
  const now = Date.now();
  const entry = memory.get(key);
  if (!entry || entry.resetAt <= now) {
    memory.set(key, { count: 1, resetAt: now + windowSecs * 1000 });
    return { ok: true, retryAfter: 0 };
  }
  entry.count += 1;
  if (entry.count <= limit) return { ok: true, retryAfter: 0 };
  return { ok: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
}

/** Counts one hit on `key`; `ok: false` once more than `limit` hits land in the window. */
export async function rateLimit(
  key: string,
  limit: number,
  windowSecs: number,
): Promise<RateLimitResult> {
  if (redis) {
    try {
      return await hitRedis(redis, key, limit, windowSecs);
    } catch {
      // Redis unreachable — fall through to the per-instance counter.
    }
  }
  return hitMemory(key, limit, windowSecs);
}

/** Gives back one hit (e.g. the guarded action failed and shouldn't count). */
export async function rateLimitUndo(key: string): Promise<void> {
  if (redis) {
    try {
      await redis.decr(key);
      return;
    } catch {
      // Fall through: the hit may have landed in the in-memory fallback.
    }
  }
  const entry = memory.get(key);
  if (entry && entry.count > 0) entry.count -= 1;
}

/** Client IP as seen by the platform proxy (Railway and Vercel set x-forwarded-for). */
export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}
