/**
 * Error text for people. The public devnet RPC rate-limits by IP and answers
 * `429 : {"error":{"message":"Too many requests from your IP"}}`, which web3.js
 * throws after its own retries; say what it means instead.
 */
export const RATE_LIMITED_MESSAGE =
  "Solana devnet is busy (too many requests). Try again in a few seconds.";

export function isRateLimited(msg: string): boolean {
  return /too many requests|rate.?limit/i.test(msg);
}

/** An error's message, with RPC rate limits in plain words. */
export function errorMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  return isRateLimited(raw) ? RATE_LIMITED_MESSAGE : raw;
}
