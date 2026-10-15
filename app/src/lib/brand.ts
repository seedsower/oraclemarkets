/**
 * User-facing product identity. Code identifiers (`@pm-amm/sdk`, `PmAmmClient`,
 * the `pm_amm` IDL) are the engine's names and intentionally stay as they are.
 * `NEXT_PUBLIC_*` values are inlined at build time (see /Dockerfile).
 */
const X_HANDLE = (process.env.NEXT_PUBLIC_X_HANDLE || "oraclexbot").replace(/^@/, "");

export const BRAND = {
  name: "Oracle Markets",
  shortName: "Oracle",
  tagline: "Prediction markets on Solana",
  description:
    'Turn any argument on X into a prediction market: reply "bet?" and the bot opens it, gives everyone a wallet, and pays the winner. Built on Paradigm\'s pm-AMM on Solana.',
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
  /** The bot's X username without "@" (NEXT_PUBLIC_X_HANDLE may include it). */
  xHandle: X_HANDLE,
  /** "@oraclexbot" — for copy and X card metadata. */
  xAt: `@${X_HANDLE}`,
} as const;

/** Engine attribution — keep wherever the product explains how pricing works. */
export const ENGINE = {
  credit: "Powered by the Paradigm pm-AMM (Moallemi & Robinson, 2024)",
  paperUrl: "https://www.paradigm.xyz/2024/11/pm-amm",
  /** Upstream MIT-licensed implementation this deployment is built on. */
  upstreamRepoUrl: "https://github.com/sparkfun-labs/pm-amm",
} as const;
