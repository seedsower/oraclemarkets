import type { XbotConfig } from "./config";
import { log } from "./log";
import type { Store } from "./store";

let lastLogged = "";

/**
 * Daily X API usage (counts from Redis) with a USD estimate when per-call
 * prices are configured. Replies containing a URL are the expensive call.
 * Logged only when the numbers change.
 */
export async function logUsage(store: Store, cfg: XbotConfig): Promise<void> {
  const u = await store.usageToday();
  const n = (k: string) => Number(u[k] ?? 0);
  const counts = { reads: n("posts_read"), posts: n("posts"), postsWithUrl: n("posts_with_url") };
  const p = cfg.prices;
  const priced = p.read !== null || p.post !== null || p.postWithUrl !== null;
  const estUsd = priced
    ? counts.reads * (p.read ?? 0) +
      counts.posts * (p.post ?? 0) +
      counts.postsWithUrl * (p.postWithUrl ?? p.post ?? 0)
    : null;
  const key = JSON.stringify(counts);
  if (key === lastLogged) return;
  lastLogged = key;
  log.info("x api usage today", {
    ...counts,
    estUsd: estUsd === null ? "set XBOT_COST_* to estimate" : Number(estUsd.toFixed(4)),
  });
}
