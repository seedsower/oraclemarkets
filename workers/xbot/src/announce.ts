import type { Store } from "./store";
import { log } from "./log";

/**
 * Curator announcements (workers/curator/src/report.ts): after a live run that
 * created markets, the curator queues {count, titles, at} in
 * `curator:announcements` — only when CURATOR_ANNOUNCE_ON_X=true on the
 * curator. The bot posts one per pass (never in dry run).
 */
export const ANNOUNCE_KEY = "curator:announcements";
const MAX_CHARS = 280;
/** X counts every link as 23 characters. */
const LINK_CHARS = 23;

export interface Announcement {
  count: number;
  titles: string[];
}

/** The post text: a headline, up to 3 titles (trimmed to fit 280), the link. */
export function announcementText(a: Announcement, siteUrl: string): string {
  const head = `🔮 ${a.count} new market${a.count === 1 ? "" : "s"}, opened at the AI consensus from oraclemarkets.io:`;
  const link = `${siteUrl}/markets?category=oracle`;
  const more = a.count > a.titles.length ? `\n…and ${a.count - a.titles.length} more` : "";
  let budget = MAX_CHARS - [...head].length - LINK_CHARS - [...more].length - 2;
  const lines: string[] = [];
  for (const t of a.titles) {
    const room = budget - 3; // "\n• "
    if (room < 12) break;
    const chars = [...t];
    const line = chars.length > room ? `${chars.slice(0, room - 1).join("")}…` : t;
    lines.push(`• ${line}`);
    budget -= [...line].length + 3;
  }
  return `${head}\n${lines.join("\n")}${more}\n\n${link}`;
}

/** Post one queued announcement, if any. A failed post goes back on the queue. */
export async function announcePass(
  store: Pick<Store, "redis">,
  x: { tweet(text: string): Promise<string> },
  siteUrl: string,
): Promise<void> {
  const raw = await store.redis.lpop(ANNOUNCE_KEY);
  if (!raw) return;
  let a: Announcement;
  try {
    a = JSON.parse(raw) as Announcement;
  } catch {
    return; // malformed: drop it
  }
  if (!(a.count > 0) || !Array.isArray(a.titles)) return;
  try {
    const id = await x.tweet(announcementText(a, siteUrl));
    log.info("curator announcement posted", { id, count: a.count });
  } catch (e) {
    await store.redis.lpush(ANNOUNCE_KEY, raw);
    throw e;
  }
}
