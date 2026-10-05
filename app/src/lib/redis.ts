import { Redis as Upstash } from "@upstash/redis";
import IORedis from "ioredis";
import { memberToString, pairsFromFlat, toInt, type ScoredMember } from "@/lib/kv-normalize";

/**
 * The handful of Redis operations the app uses, with one reply shape whatever
 * the backend: Railway's TCP Redis (`REDIS_URL`, via ioredis) or Upstash REST
 * (`KV_REST_API_URL` + `KV_REST_API_TOKEN`). Values/members are always strings.
 * Callers must treat every call as fallible and degrade (see rate-limit.ts).
 */
export interface KvStore {
  incr(key: string): Promise<number>;
  decr(key: string): Promise<number>;
  expire(key: string, secs: number): Promise<void>;
  ttl(key: string): Promise<number>;
  zadd(key: string, score: number, member: string): Promise<void>;
  zrange(key: string, start: number, stop: number): Promise<string[]>;
  zrange(
    key: string,
    start: number,
    stop: number,
    opts: { withScores: true },
  ): Promise<ScoredMember[]>;
  zcard(key: string): Promise<number>;
  zremrangebyrank(key: string, start: number, stop: number): Promise<void>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, opts?: { ex?: number }): Promise<void>;
  hset(key: string, field: string, value: string): Promise<void>;
  hgetall(key: string): Promise<Record<string, string>>;
  hget(key: string, field: string): Promise<string | null>;
}

export type RedisKind = "tcp" | "upstash" | "none";

export const redisKind: RedisKind = process.env.REDIS_URL
  ? "tcp"
  : process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN
    ? "upstash"
    : "none";

/** How long a request waits for a (re)connecting TCP client before giving up. */
const READY_TIMEOUT_MS = 1500;

let tcpClient: IORedis | null = null;

function tcp(): IORedis {
  if (!tcpClient) {
    tcpClient = new IORedis(process.env.REDIS_URL!, {
      maxRetriesPerRequest: 2,
      // Fail fast instead of queueing while disconnected — callers degrade.
      enableOfflineQueue: false,
      // Railway private networking resolves over IPv6; 0 = try both families.
      family: 0,
      // RESP2 keeps ZRANGE WITHSCORES flat (RESP3 nests [member, score] pairs);
      // pairsFromFlat accepts both anyway.
      protocol: 2,
    });
    // Without a listener, connection errors are thrown as unhandled events.
    tcpClient.on("error", () => {});
  }
  return tcpClient;
}

/** Statuses where a connect attempt is in flight and worth briefly waiting on. */
const CONNECTING = new Set(["wait", "connecting", "connect"]);

/**
 * The offline queue is off, so wait (briefly) for an in-flight connect. While
 * ioredis is in its reconnect loop (Redis down) fail at once instead, so every
 * request doesn't pay the timeout before degrading.
 */
async function ready(): Promise<IORedis> {
  const c = tcp();
  if (c.status === "ready") return c;
  if (!CONNECTING.has(c.status)) throw new Error(`redis ${c.status}`);
  await new Promise<void>((resolve, reject) => {
    const settle = (err?: Error) => {
      clearTimeout(timer);
      c.off("ready", onReady);
      c.off("close", onClose);
      if (err) reject(err);
      else resolve();
    };
    const onReady = () => settle();
    // A refused/dropped connect closes before retrying — don't wait out the timer.
    const onClose = () => settle(new Error("redis closed"));
    const timer = setTimeout(() => settle(new Error("redis not ready")), READY_TIMEOUT_MS);
    c.once("ready", onReady);
    c.once("close", onClose);
  });
  return c;
}

function ioredisStore(): KvStore {
  return {
    incr: async (k) => (await ready()).incr(k),
    decr: async (k) => (await ready()).decr(k),
    expire: async (k, s) => void (await (await ready()).expire(k, s)),
    ttl: async (k) => (await ready()).ttl(k),
    zadd: async (k, score, m) => void (await (await ready()).zadd(k, score, m)),
    zrange: (async (k: string, a: number, b: number, o?: { withScores: true }) => {
      const c = await ready();
      // ioredis types `stop` as string-only; Redis parses either.
      if (o?.withScores) return pairsFromFlat(await c.zrange(k, a, String(b), "WITHSCORES"));
      return c.zrange(k, a, String(b));
    }) as KvStore["zrange"],
    zcard: async (k) => (await ready()).zcard(k),
    zremrangebyrank: async (k, a, b) => void (await (await ready()).zremrangebyrank(k, a, b)),
    get: async (k) => (await ready()).get(k),
    set: async (k, v, o) => {
      const c = await ready();
      await (o?.ex ? c.set(k, v, "EX", o.ex) : c.set(k, v));
    },
    hset: async (k, f, v) => void (await (await ready()).hset(k, f, v)),
    hgetall: async (k) => (await ready()).hgetall(k),
    hget: async (k, f) => (await ready()).hget(k, f),
  };
}

function upstashStore(url: string, token: string): KvStore {
  // Raw strings in, raw strings out — same as ioredis.
  const r = new Upstash({ url, token, automaticDeserialization: false });
  return {
    incr: (k) => r.incr(k),
    decr: (k) => r.decr(k),
    expire: async (k, s) => void (await r.expire(k, s)),
    ttl: (k) => r.ttl(k),
    zadd: async (k, score, member) => void (await r.zadd(k, { score, member })),
    zrange: (async (k: string, a: number, b: number, o?: { withScores: true }) => {
      if (o?.withScores) return pairsFromFlat(await r.zrange(k, a, b, { withScores: true }));
      return (await r.zrange(k, a, b)).map(memberToString);
    }) as KvStore["zrange"],
    zcard: async (k) => toInt(await r.zcard(k)),
    zremrangebyrank: async (k, a, b) => void (await r.zremrangebyrank(k, a, b)),
    get: async (k) => {
      const v = await r.get(k);
      return v === null || v === undefined ? null : memberToString(v);
    },
    set: async (k, v, o) => void (await (o?.ex ? r.set(k, v, { ex: o.ex }) : r.set(k, v))),
    hset: async (k, f, v) => void (await r.hset(k, { [f]: v })),
    hgetall: async (k) => {
      const h = (await r.hgetall(k)) ?? {};
      return Object.fromEntries(Object.entries(h).map(([f, v]) => [f, memberToString(v)]));
    },
    hget: async (k, f) => {
      const v = await r.hget(k, f);
      return v === null || v === undefined ? null : memberToString(v);
    },
  };
}

function createStore(): KvStore | null {
  if (redisKind === "tcp") return ioredisStore();
  if (redisKind === "upstash") {
    return upstashStore(process.env.KV_REST_API_URL!, process.env.KV_REST_API_TOKEN!);
  }
  return null;
}

/** Null when no Redis is configured (local dev) — callers must handle it. */
export const redis: KvStore | null = createStore();
