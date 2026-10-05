import IORedis from "ioredis";
import type { GroupRow, MarketRow } from "./replies";
import type { PendingBet } from "./betting";

/**
 * Bot state in the shared Redis (same instance as web + keeper).
 *   xbot:refresh_token      rotating OAuth refresh token (X rotates on every use)
 *   xbot:since_id           mentions cursor
 *   xbot:seen:<tweet>       dedupe (7 d)
 *   xbot:cooldown:<user>    one reply per user per 10 min
 *   xbot:replies:<day>      daily reply count (dry runs: xbot:dryreplies:<day>)
 *   xbot:usage:<day>        hash of API call counts for cost estimates (30 d)
 *   xbot:pending:<reply>    bet waiting for an answer to the bot's follow-up (2 d)
 *   art / art:fails         market art: account → SVG, and failed attempts (see art.ts)
 *   xwallets                custodial wallets (wallets.ts)
 *   xbot:spend|withdrawn:<user>:<day>  USD traded / withdrawn today (2 d)
 *   xbot:lock:<user>        one money action at a time per user (90 s)
 *   xbot:open:<user>        set of "m:<market>" / "b:<bet vault>" to pay out; xbot:open-users
 *   xbot:open-post:<user>   hash member → the post to reply to when it pays out
 *   proposals:<tweet>       JSON proposal; index in sorted set proposals:index
 */
const DAY_SECS = 86_400;
export const COOLDOWN_SECS = 600;

export interface Proposal {
  id: string;
  question: string;
  by: string;
  deadline: string | null;
  handle: string;
  authorId: string;
  tweetUrl: string;
  createdAt: number;
}

/** Same shape the web reads (app/src/lib/bets.ts `BetMeta`). */
export interface BetMetaRecord {
  vaultId: number;
  question: string;
  /** The take as posted, when Claude rewrote it into `question`. */
  take?: string | null;
  /** How it resolves (Claude-written); null → none. */
  rules?: string | null;
  sourceUrl: string | null;
  openedBy: string | null;
  deadline: string | null;
  createdAt: number;
}

/** Fields of the SDK's BetVaultView the bot's lifecycle needs. */
export interface BetVaultRow {
  publicKey: string;
  vaultId: number;
  authority: string;
  market: string;
  launched: boolean;
  settled: boolean;
  voided: boolean;
  refunding: boolean;
  commitEndTs: number;
  marketEndTs: number;
  yesTotal: number;
  noTotal: number;
  total: number;
  minTotal: number;
  voidGraceSecs: number;
  // remaining BetVaultView fields are present but unused here
  [k: string]: unknown;
}

export const today = (d = new Date()) => d.toISOString().slice(0, 10);

export class Store {
  constructor(readonly redis: IORedis) {}

  static connect(url: string): Store {
    const redis = new IORedis(url, { maxRetriesPerRequest: 2, family: 0, protocol: 2 });
    redis.on("error", () => {}); // surfaced by the failing command
    return new Store(redis);
  }

  getRefreshToken = () => this.redis.get("xbot:refresh_token");
  setRefreshToken = (t: string) => this.redis.set("xbot:refresh_token", t);
  getCursor = () => this.redis.get("xbot:since_id");
  setCursor = (id: string) => this.redis.set("xbot:since_id", id);

  /** True the first time a tweet id is seen. */
  async markSeen(id: string): Promise<boolean> {
    return (await this.redis.set(`xbot:seen:${id}`, "1", "EX", 7 * DAY_SECS, "NX")) === "OK";
  }

  /** True (and starts the cooldown) if this user may get a reply now. */
  async takeCooldown(userId: string): Promise<boolean> {
    return (
      (await this.redis.set(`xbot:cooldown:${userId}`, "1", "EX", COOLDOWN_SECS, "NX")) === "OK"
    );
  }

  private repliesKey = (dry: boolean) => `xbot:${dry ? "dryreplies" : "replies"}:${today()}`;

  async repliesToday(dry: boolean): Promise<number> {
    return Number((await this.redis.get(this.repliesKey(dry))) ?? 0);
  }

  async countReply(dry: boolean): Promise<void> {
    const k = this.repliesKey(dry);
    await this.redis
      .multi()
      .incr(k)
      .expire(k, 2 * DAY_SECS)
      .exec();
  }

  async usage(field: string, by = 1): Promise<void> {
    const k = `xbot:usage:${today()}`;
    await this.redis
      .multi()
      .hincrby(k, field, by)
      .expire(k, 30 * DAY_SECS)
      .exec();
  }

  usageToday = async () => this.redis.hgetall(`xbot:usage:${today()}`);

  async saveProposal(p: Proposal): Promise<void> {
    await this.redis
      .multi()
      .set(`proposals:${p.id}`, JSON.stringify(p))
      .zadd("proposals:index", p.createdAt, p.id)
      .exec();
  }

  /** Increment a per-day counter (bets opened, globally or per user). */
  async bump(key: string): Promise<number> {
    const k = `${key}:${today()}`;
    const [[, n]] = (await this.redis
      .multi()
      .incr(k)
      .expire(k, 2 * DAY_SECS)
      .exec()) as [[unknown, number]];
    return n;
  }

  async count(key: string): Promise<number> {
    return Number((await this.redis.get(`${key}:${today()}`)) ?? 0);
  }

  /** One bet per take: the vault already opened for this source post. */
  betForPost = (postId: string) => this.redis.get(`bets:by_post:${postId}`);

  async saveBet(meta: BetMetaRecord, sourcePostId: string | null): Promise<void> {
    const m = this.redis.multi().set(`bets:meta:${meta.vaultId}`, JSON.stringify(meta));
    if (sourcePostId) m.set(`bets:by_post:${sourcePostId}`, String(meta.vaultId));
    await m.exec();
  }

  savePendingBet = (replyId: string, p: PendingBet) =>
    this.redis.set(`xbot:pending:${replyId}`, JSON.stringify(p), "EX", 2 * DAY_SECS);

  async pendingBet(replyId: string): Promise<PendingBet | null> {
    const raw = await this.redis.get(`xbot:pending:${replyId}`);
    return raw ? (JSON.parse(raw) as PendingBet) : null;
  }

  // ── trading from X ──

  async addUsd(kind: "spend" | "withdrawn", userId: string, usd: number): Promise<void> {
    const k = `xbot:${kind}:${userId}:${today()}`;
    await this.redis
      .multi()
      .incrbyfloat(k, usd)
      .expire(k, 2 * DAY_SECS)
      .exec();
  }

  async usdToday(kind: "spend" | "withdrawn", userId: string): Promise<number> {
    return Number((await this.redis.get(`xbot:${kind}:${userId}:${today()}`)) ?? 0);
  }

  /** True if this user had no money action in flight (then holds the lock ≤ 90 s). */
  async lock(userId: string): Promise<boolean> {
    return (await this.redis.set(`xbot:lock:${userId}`, "1", "EX", 90, "NX")) === "OK";
  }

  unlock = (userId: string) => this.redis.del(`xbot:lock:${userId}`);

  async trackOpen(userId: string, member: string, postId: string): Promise<void> {
    await this.redis
      .multi()
      .sadd(`xbot:open:${userId}`, member)
      .sadd("xbot:open-users", userId)
      .hset(`xbot:open-post:${userId}`, member, postId)
      .exec();
  }

  async untrackOpen(userId: string, member: string): Promise<void> {
    await this.redis
      .multi()
      .srem(`xbot:open:${userId}`, member)
      .hdel(`xbot:open-post:${userId}`, member)
      .exec();
    if ((await this.redis.scard(`xbot:open:${userId}`)) === 0) {
      await this.redis.srem("xbot:open-users", userId);
    }
  }

  async openFor(userId: string): Promise<{ member: string; postId: string | null }[]> {
    const [members, posts] = await Promise.all([
      this.redis.smembers(`xbot:open:${userId}`),
      this.redis.hgetall(`xbot:open-post:${userId}`),
    ]);
    return members.map((member) => ({ member, postId: posts[member] ?? null }));
  }

  openUsers = () => this.redis.smembers("xbot:open-users");

  /** Same hash the web's /api/categories reads (account → slug). */
  setCategory = (account: string, slug: string) => this.redis.hset("categories", account, slug);

  /** Keeper snapshot of bet vaults (`cache:bet_vaults`). */
  betVaults = () => this.rows<BetVaultRow>("cache:bet_vaults");

  private async rows<T>(key: string): Promise<T[]> {
    const raw = await this.redis.get(key);
    const items = raw ? (JSON.parse(raw) as { items?: unknown }).items : null;
    return Array.isArray(items) ? (items as T[]) : [];
  }

  /** Every keeper list (market art covers all of them). */
  async lists() {
    const [markets, groups, vaults, vaultGroups, betVaults] = await Promise.all(
      ["markets", "groups", "vaults", "vault_groups", "bet_vaults"].map((k) =>
        this.rows<Record<string, unknown>>(`cache:${k}`),
      ),
    );
    return {
      markets: markets!,
      groups: groups!,
      vaults: vaults!,
      vaultGroups: vaultGroups!,
      betVaults: betVaults!,
    };
  }

  /** The keeper's snapshot (web's /api/markets reads the same keys). */
  async snapshot(): Promise<{ markets: MarketRow[]; groups: GroupRow[] }> {
    const [markets, groups] = await Promise.all([
      this.rows<MarketRow>("cache:markets"),
      this.rows<GroupRow>("cache:groups"),
    ]);
    return { markets, groups };
  }
}
