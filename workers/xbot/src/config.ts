function num(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function list(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/** Optional per-call prices (USD) for the daily cost estimate; unset = counts only. */
function price(name: string): number | null {
  const n = Number(process.env[name]);
  return process.env[name] && Number.isFinite(n) && n >= 0 ? n : null;
}

import type { OAuth1Keys } from "./oauth1";

export type XAuth =
  /** Access Token + Secret generated in the developer portal (no browser step). */
  | ({ kind: "oauth1" } & OAuth1Keys)
  /** OAuth 2.0 user context from the `auth` script; refresh tokens rotate. */
  | { kind: "oauth2"; clientId: string; clientSecret: string; refreshToken: string };

export interface XCreds {
  auth: XAuth;
  /** Looked up via GET /2/users/me at startup when not set. */
  botUserId: string | null;
}

/** OAuth 1.0a wins when all four keys are set; else OAuth 2.0; else null. */
function xCreds(e: NodeJS.ProcessEnv): XCreds | null {
  const botUserId = e.X_BOT_USER_ID || null;
  if (e.X_API_KEY && e.X_API_SECRET && e.X_ACCESS_TOKEN && e.X_ACCESS_SECRET) {
    return {
      botUserId,
      auth: {
        kind: "oauth1",
        consumerKey: e.X_API_KEY,
        consumerSecret: e.X_API_SECRET,
        token: e.X_ACCESS_TOKEN,
        tokenSecret: e.X_ACCESS_SECRET,
      },
    };
  }
  if (e.X_CLIENT_ID && e.X_CLIENT_SECRET) {
    const auth = {
      kind: "oauth2" as const,
      clientId: e.X_CLIENT_ID,
      clientSecret: e.X_CLIENT_SECRET,
      refreshToken: e.X_REFRESH_TOKEN ?? "",
    };
    return { botUserId, auth };
  }
  return null;
}

export interface XbotConfig {
  redisUrl: string;
  siteUrl: string;
  pollMs: number;
  dailyReplyCap: number;
  /** Default true: log the replies it WOULD send, send none. */
  dryRun: boolean;
  /** Scripted mentions JSON (testing). Implies dry run; no X API calls at all. */
  fixture: string | null;
  featured: Set<string>;
  /** null = no X credentials (the bot idles). */
  x: XCreds | null;
  prices: { read: number | null; post: number | null; postWithUrl: number | null };
}

export function loadConfig(): XbotConfig {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) throw new Error("REDIS_URL is required");
  const fixture = process.env.XBOT_FIXTURE || null;
  const x = xCreds(process.env);
  return {
    redisUrl,
    siteUrl: (process.env.XBOT_SITE_URL || "https://oraclemarkets.app").replace(/\/$/, ""),
    pollMs: num("XBOT_POLL_SECS", 60) * 1000,
    dailyReplyCap: Math.floor(num("XBOT_DAILY_REPLY_CAP", 100)),
    dryRun: fixture !== null || process.env.XBOT_DRY_RUN !== "false",
    fixture,
    featured: list(
      process.env.XBOT_FEATURED_AUTHORITIES || process.env.NEXT_PUBLIC_FEATURED_AUTHORITIES,
    ),
    x,
    prices: {
      read: price("XBOT_COST_PER_READ_USD"),
      post: price("XBOT_COST_PER_POST_USD"),
      postWithUrl: price("XBOT_COST_PER_URL_POST_USD"),
    },
  };
}
