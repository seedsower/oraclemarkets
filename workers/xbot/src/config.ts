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
  x: { clientId: string; clientSecret: string; refreshToken: string; botUserId: string } | null;
  prices: { read: number | null; post: number | null; postWithUrl: number | null };
}

export function loadConfig(): XbotConfig {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) throw new Error("REDIS_URL is required");
  const fixture = process.env.XBOT_FIXTURE || null;
  const { X_CLIENT_ID, X_CLIENT_SECRET, X_REFRESH_TOKEN, X_BOT_USER_ID } = process.env;
  const x =
    X_CLIENT_ID && X_CLIENT_SECRET && X_BOT_USER_ID
      ? {
          clientId: X_CLIENT_ID,
          clientSecret: X_CLIENT_SECRET,
          refreshToken: X_REFRESH_TOKEN ?? "",
          botUserId: X_BOT_USER_ID,
        }
      : null;
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
