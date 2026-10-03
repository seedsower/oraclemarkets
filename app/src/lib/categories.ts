/**
 * Market categories. Stored off-chain (Redis hash `categories`: account →
 * slug) because the on-chain accounts have no category field. Keyed by the
 * created account (market / group / vault / vault group / bet vault); a
 * launched market inherits its vault's category (see resolveCategory).
 */
export const CATEGORIES = [
  { slug: "crypto", label: "Crypto" },
  { slug: "sports", label: "Sports" },
  { slug: "politics", label: "Politics" },
  { slug: "science", label: "Science" },
  { slug: "entertainment", label: "Entertainment" },
  { slug: "finance", label: "Finance" },
  { slug: "personal", label: "Personal" },
] as const;

export type CategorySlug = (typeof CATEGORIES)[number]["slug"];

const SLUGS = new Set<string>(CATEGORIES.map((c) => c.slug));

export function isCategory(v: unknown): v is CategorySlug {
  return typeof v === "string" && SLUGS.has(v);
}

export function categoryLabel(slug: string | undefined | null): string | null {
  return CATEGORIES.find((c) => c.slug === slug)?.label ?? null;
}

/**
 * The exact text a creator signs to set a category (free, no transaction).
 * The timestamp bounds replay; the server checks it's within ±10 minutes.
 */
export function categoryMessage(account: string, slug: CategorySlug, ts: number): string {
  return `Oracle Markets: set the category of ${account} to "${slug}" (ts ${ts})`;
}

/**
 * Wallets that may categorize ANY market (e.g. to tag existing ones):
 * NEXT_PUBLIC_CATEGORY_ADMINS (public addresses, comma-separated) plus the
 * featured authorities. Used by the editor UI and enforced by the API.
 */
export function categoryAdmins(featured: Iterable<string> = []): Set<string> {
  const raw = process.env.NEXT_PUBLIC_CATEGORY_ADMINS ?? "";
  const listed = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return new Set([...listed, ...featured]);
}

/** Off-chain links from a launched market/group back to the vault that created it. */
export interface CategoryLinks {
  /** launched market pubkey → vault (binary or bet) pubkey */
  marketToVault: Map<string, string>;
  /** group pubkey → multi-outcome vault pubkey */
  groupToVault: Map<string, string>;
}

/** Direct category, else the creating vault's. */
export function resolveCategory(
  account: string,
  map: Record<string, string> | undefined,
  links?: CategoryLinks,
): CategorySlug | null {
  const direct = map?.[account];
  if (isCategory(direct)) return direct;
  const via = links?.marketToVault.get(account) ?? links?.groupToVault.get(account);
  const inherited = via ? map?.[via] : undefined;
  return isCategory(inherited) ? inherited : null;
}
