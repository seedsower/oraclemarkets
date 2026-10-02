/**
 * Mobile wallets' documented "browse" deeplinks: open a page inside the
 * wallet's in-app browser, where the wallet is already connected.
 *   Phantom:  https://phantom.app/ul/browse/<url>?ref=<ref>
 *   Solflare: https://solflare.com/ul/v1/browse/<url>?ref=<ref>
 * (both URL-encoded; see docs.phantom.com / docs.solflare.com "browse").
 */
export function walletBrowseLinks(url: string, ref: string) {
  const u = encodeURIComponent(url);
  const r = encodeURIComponent(ref);
  return {
    phantom: `https://phantom.app/ul/browse/${u}?ref=${r}`,
    solflare: `https://solflare.com/ul/v1/browse/${u}?ref=${r}`,
  };
}

/** Phone/tablet browser with no injected Solana wallet (e.g. opened from the X app). */
export function needsWalletApp(): boolean {
  if (typeof window === "undefined") return false;
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const w = window as unknown as {
    solana?: unknown;
    phantom?: { solana?: unknown };
    solflare?: unknown;
    backpack?: unknown;
  };
  const injected = Boolean(w.solana || w.phantom?.solana || w.solflare || w.backpack);
  return mobile && !injected;
}
