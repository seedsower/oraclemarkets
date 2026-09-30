import { log, errMsg } from "./log";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function isRateLimited(e: unknown): boolean {
  return /429|too many requests|rate.?limit/i.test(errMsg(e));
}

/**
 * Retry an RPC call on 429 with exponential backoff + jitter (0.5 s → 8 s).
 * Other errors are thrown at once — the caller decides whether they're fatal.
 * The Connection is built with `disableRetryOnRateLimit` so this is the only
 * retry layer.
 */
export async function withBackoff<T>(label: string, fn: () => Promise<T>, tries = 5): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (!isRateLimited(e) || attempt + 1 >= tries) throw e;
      const delay = 500 * 2 ** attempt + Math.floor(Math.random() * 250);
      log.warn("rpc rate-limited, backing off", {
        call: label,
        attempt: attempt + 1,
        delayMs: delay,
      });
      await sleep(delay);
    }
  }
}
