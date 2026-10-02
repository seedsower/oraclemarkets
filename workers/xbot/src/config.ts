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

import { Keypair, PublicKey } from "@solana/web3.js";
import type { OAuth1Keys } from "./oauth1";

/** Opening bets from X (Bet Vault v2). null → `bet?` replies "not enabled". */
export interface BetsConfig {
  /** Dedicated low-balance hot wallet: pays rent, opens + launches bets. */
  wallet: Keypair;
  /** The ONLY key that can resolve these bets (your admin wallet; never on Railway). */
  resolver: PublicKey;
  rpcUrl: string;
  programId: PublicKey;
  collateralMint: PublicKey;
  stakeWindowSecs: number;
  /** Minimum total stake (USDC) for a bet to launch. */
  minTotalUsdc: number;
  /** Share of the pot seeded as liquidity at launch (capped on-chain). */
  lpBps: number;
  perDay: number;
  perUserPerDay: number;
  /** Stop opening bets below this wallet balance. */
  minLamports: number;
}

function betsConfig(e: NodeJS.ProcessEnv): BetsConfig | null {
  if (!e.XBOT_WALLET || !e.XBOT_BET_RESOLVER) return null;
  const secret = Buffer.from(e.XBOT_WALLET, "base64");
  if (secret.length !== 64) throw new Error("XBOT_WALLET must be base64 of a 64-byte secret key");
  return {
    wallet: Keypair.fromSecretKey(secret),
    resolver: new PublicKey(e.XBOT_BET_RESOLVER),
    rpcUrl: e.XBOT_RPC_URL || "https://api.devnet.solana.com",
    programId: new PublicKey(e.PROGRAM_ID || "GV1FMGHRYBjQLaghE5fnGuYCuCcpdt3GD5xEX3TwN16y"),
    collateralMint: new PublicKey(e.USDC_MINT || "3WQ8hCqTNwjrh8WzE2XyoZoUrd1miPcwWfMkmFPUMEWZ"),
    // Default staking window; a bet can override it with "in 30m" / "in 2h".
    stakeWindowSecs: num("XBOT_BET_STAKE_HOURS", 1) * 3600,
    minTotalUsdc: num("XBOT_BET_MIN_TOTAL_USDC", 2),
    lpBps: Math.floor(num("XBOT_BET_LP_BPS", 5000)),
    perDay: Math.floor(num("XBOT_BETS_PER_DAY", 10)),
    perUserPerDay: Math.floor(num("XBOT_BETS_PER_USER_PER_DAY", 2)),
    minLamports: Math.floor(num("XBOT_MIN_SOL", 0.05) * 1e9),
  };
}

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
  bets: BetsConfig | null;
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
    bets: betsConfig(process.env),
    prices: {
      read: price("XBOT_COST_PER_READ_USD"),
      post: price("XBOT_COST_PER_POST_USD"),
      postWithUrl: price("XBOT_COST_PER_URL_POST_USD"),
    },
  };
}
