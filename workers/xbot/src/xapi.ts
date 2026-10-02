import { readFileSync } from "node:fs";
import type { XAuth } from "./config";
import { oauth1Header } from "./oauth1";
import { log } from "./log";
import type { Store } from "./store";

const API = "https://api.x.com/2";

/** The post a mention replies to or quotes — "the take" for `bet?`. */
export interface ParentPost {
  id: string;
  text: string;
  username: string;
}

export interface Mention {
  id: string;
  text: string;
  authorId: string;
  username: string;
  parent: ParentPost | null;
}

/** Where mentions come from and where replies go (real X API, or a fixture). */
export interface MentionSource {
  fetchMentions(sinceId: string | null): Promise<{ mentions: Mention[]; newestId: string | null }>;
  reply(text: string, inReplyTo: string): Promise<string>;
}

export class RateLimited extends Error {
  constructor(readonly resetAt: number) {
    super(`X API rate limited until ${new Date(resetAt).toISOString()}`);
  }
}

interface RawTweet {
  id: string;
  text: string;
  author_id?: string;
  referenced_tweets?: { type: string; id: string }[];
}

interface RawPage {
  data?: RawTweet[];
  includes?: { users?: { id: string; username: string }[]; tweets?: RawTweet[] };
  meta?: { newest_id?: string; next_token?: string };
}

/** The replied-to (or else quoted) post, with its author's username. */
function parentOf(
  t: RawTweet,
  tweets: Map<string, RawTweet>,
  users: Map<string, string>,
): ParentPost | null {
  const ref =
    t.referenced_tweets?.find((r) => r.type === "replied_to") ??
    t.referenced_tweets?.find((r) => r.type === "quoted");
  const p = ref ? tweets.get(ref.id) : undefined;
  return p ? { id: p.id, text: p.text, username: users.get(p.author_id ?? "") ?? "" } : null;
}

/** Builds the Authorization header for one request (OAuth 1.0a or 2.0). */
type Authorizer = (method: string, url: string) => Promise<string>;

/** OAuth 2.0: refresh-token grant; rotated refresh tokens are persisted first. */
function oauth2Authorizer(a: Extract<XAuth, { kind: "oauth2" }>, store: Store): Authorizer {
  let access: { token: string; exp: number } | null = null;
  return async () => {
    if (!access || Date.now() >= access.exp - 60_000) {
      const refresh = (await store.getRefreshToken()) || a.refreshToken;
      if (!refresh)
        throw new Error("no refresh token — run the auth script, or use OAuth 1.0a keys");
      const basic = Buffer.from(`${a.clientId}:${a.clientSecret}`).toString("base64");
      const res = await fetch(`${API}/oauth2/token`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${basic}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refresh,
          client_id: a.clientId,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        error_description?: string;
      };
      if (!res.ok || !body.access_token) {
        throw new Error(
          `token refresh failed (${res.status}): ${body.error_description ?? "re-run auth"}`,
        );
      }
      if (body.refresh_token) await store.setRefreshToken(body.refresh_token);
      access = { token: body.access_token, exp: Date.now() + (body.expires_in ?? 7200) * 1000 };
      await store.usage("token_refresh");
    }
    return `Bearer ${access.token}`;
  };
}

export function makeAuthorizer(auth: XAuth, store: Store): Authorizer {
  if (auth.kind === "oauth1") {
    return async (method, url) => oauth1Header({ method, url, keys: auth });
  }
  return oauth2Authorizer(auth, store);
}

/** GET /2/users/me — the authenticated account (used to find the bot's user id). */
export async function whoAmI(authorize: Authorizer): Promise<{ id: string; username: string }> {
  const url = `${API}/users/me`;
  const res = await fetch(url, { headers: { Authorization: await authorize("GET", url) } });
  const body = (await res.json().catch(() => ({}))) as {
    data?: { id: string; username: string };
    detail?: string;
    title?: string;
  };
  if (!res.ok || !body.data) {
    throw new Error(
      `users/me ${res.status}: ${body.detail ?? body.title ?? JSON.stringify(body).slice(0, 200)}`,
    );
  }
  return body.data;
}

/** X API v2 client for the bot account (mentions in, replies out). */
export class XApi implements MentionSource {
  /** X renamed `tweet.fields` → `post.fields` in its docs; use whichever it accepts. */
  private fieldsParam = "tweet.fields";

  constructor(
    private readonly authorize: Authorizer,
    private readonly botUserId: string,
    private readonly store: Store,
  ) {}

  private async call(path: string, init: RequestInit = {}): Promise<Response> {
    const url = `${API}${path}`;
    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: await this.authorize(init.method ?? "GET", url),
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
    if (res.status === 429) {
      const reset = Number(res.headers.get("x-rate-limit-reset")) * 1000;
      throw new RateLimited(Number.isFinite(reset) && reset > 0 ? reset : Date.now() + 15 * 60_000);
    }
    return res;
  }

  private async page(sinceId: string | null, next?: string): Promise<RawPage> {
    const q = new URLSearchParams({
      max_results: "100",
      // Also return the post each mention replies to / quotes (the take for `bet?`).
      expansions: "author_id,referenced_tweets.id,referenced_tweets.id.author_id",
      "user.fields": "username",
      [this.fieldsParam]: "author_id,created_at,referenced_tweets",
    });
    if (sinceId) q.set("since_id", sinceId);
    if (next) q.set("pagination_token", next);
    const res = await this.call(`/users/${this.botUserId}/mentions?${q}`);
    const body = (await res.json().catch(() => ({}))) as RawPage & {
      errors?: unknown;
      detail?: string;
    };
    if (
      res.status === 400 &&
      this.fieldsParam === "tweet.fields" &&
      /fields/i.test(JSON.stringify(body))
    ) {
      this.fieldsParam = "post.fields";
      log.warn("X rejected tweet.fields; retrying with post.fields");
      return this.page(sinceId, next);
    }
    if (!res.ok) throw new Error(`mentions ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
    return body;
  }

  async fetchMentions(sinceId: string | null) {
    const mentions: Mention[] = [];
    let newestId: string | null = null;
    let next: string | undefined;
    for (let i = 0; i < 3; i++) {
      const p = await this.page(sinceId, next);
      const users = new Map((p.includes?.users ?? []).map((u) => [u.id, u.username]));
      const tweets = new Map((p.includes?.tweets ?? []).map((t) => [t.id, t]));
      for (const t of p.data ?? []) {
        mentions.push({
          id: t.id,
          text: t.text,
          authorId: t.author_id ?? "",
          username: users.get(t.author_id ?? "") ?? "",
          parent: parentOf(t, tweets, users),
        });
      }
      newestId ??= p.meta?.newest_id ?? null;
      await this.store.usage("posts_read", p.data?.length ?? 0);
      next = p.meta?.next_token;
      if (!next) break;
    }
    return { mentions, newestId };
  }

  async reply(text: string, inReplyTo: string): Promise<string> {
    const res = await this.call("/tweets", {
      method: "POST",
      body: JSON.stringify({ text, reply: { in_reply_to_tweet_id: inReplyTo } }),
    });
    const body = (await res.json().catch(() => ({}))) as { data?: { id: string }; detail?: string };
    if (!res.ok || !body.data) throw new Error(`reply ${res.status}: ${body.detail ?? "failed"}`);
    await this.store.usage(/https?:\/\//.test(text) ? "posts_with_url" : "posts");
    return body.data.id;
  }
}

/** Scripted mentions from a JSON file — for dry-run tests. Never touches X. */
export class FixtureSource implements MentionSource {
  private served = false;
  constructor(private readonly path: string) {}

  async fetchMentions() {
    if (this.served) return { mentions: [], newestId: null };
    this.served = true;
    const raw = JSON.parse(readFileSync(this.path, "utf8")) as {
      id: string;
      text: string;
      author_id: string;
      username: string;
      parent?: ParentPost;
    }[];
    const mentions = raw.map((r) => ({
      id: r.id,
      text: r.text,
      authorId: r.author_id,
      username: r.username,
      parent: r.parent ?? null,
    }));
    return { mentions, newestId: mentions.at(-1)?.id ?? null };
  }

  async reply(): Promise<string> {
    throw new Error("FixtureSource never posts (dry run only)");
  }
}
