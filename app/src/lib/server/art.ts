import { PublicKey } from "@solana/web3.js";
import { LIST_CACHE } from "@/lib/list-cache";
import { redis } from "@/lib/redis";

/**
 * Market art drawn by the X bot (workers/xbot/src/art.ts): Redis hash `art`,
 * account → sanitized SVG. A market launched from a vault or bet, or a group
 * launched from a multi-outcome vault, shows the vault's art.
 */
const ART_KEY = "art";

export function isAccount(v: string): boolean {
  try {
    return new PublicKey(v).toBase58() === v;
  } catch {
    return false;
  }
}

async function items(key: string): Promise<Record<string, unknown>[]> {
  const raw = await redis!.get(key);
  if (!raw) return [];
  const parsed = JSON.parse(raw) as { items?: unknown };
  return Array.isArray(parsed.items) ? (parsed.items as Record<string, unknown>[]) : [];
}

/** The vault (binary, bet or multi-outcome) that launched `account`, if any. */
async function parentOf(account: string): Promise<string | null> {
  const [vaults, bets, groups] = await Promise.all([
    items(LIST_CACHE.vaults),
    items(LIST_CACHE.betVaults),
    items(LIST_CACHE.vaultGroups),
  ]);
  const hit =
    [...vaults, ...bets].find((v) => v.market === account) ??
    groups.find((v) => v.groupMarket === account);
  return typeof hit?.publicKey === "string" ? hit.publicKey : null;
}

export async function getArt(account: string): Promise<string | null> {
  if (!redis || !isAccount(account)) return null;
  try {
    const own = await redis.hget(ART_KEY, account);
    if (own) return own;
    const parent = await parentOf(account);
    return parent ? await redis.hget(ART_KEY, parent) : null;
  } catch {
    return null;
  }
}

/** For share cards (Satori renders <img> data URIs). */
export async function getArtDataUri(account: string): Promise<string | null> {
  const svg = await getArt(account);
  return svg ? `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}` : null;
}
