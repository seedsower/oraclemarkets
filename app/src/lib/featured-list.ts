import { PublicKey } from "@solana/web3.js";

/**
 * NEXT_PUBLIC_FEATURED_AUTHORITIES (comma-separated pubkeys), parsed once.
 * Plain module so both client curation (lib/featured.ts) and server routes
 * (Actions' ACTIONS_FEATURED_ONLY) can use it.
 */
function parseAuthorities(raw: string | undefined): ReadonlySet<string> {
  const out = new Set<string>();
  for (const part of (raw ?? "").split(",")) {
    const s = part.trim();
    if (!s) continue;
    try {
      out.add(new PublicKey(s).toBase58());
    } catch {
      // Ignore malformed entries rather than breaking the page.
    }
  }
  return out;
}

export const FEATURED_AUTHORITIES = parseAuthorities(process.env.NEXT_PUBLIC_FEATURED_AUTHORITIES);
export const HAS_FEATURED = FEATURED_AUTHORITIES.size > 0;
