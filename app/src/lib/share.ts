import { BRAND } from "@/lib/brand";

/**
 * Pure copy/URL helpers for share cards, metadata and "Share on X" — used by
 * server (OG images, generateMetadata) and client (buttons, toasts).
 */

// Shared with the X bot (workers/xbot) so replies and cards read the same.
export { formatCents as cents, formatClosesIn as closesIn, legLabel } from "@pm-amm/sdk/math";
import { formatCents as cents, formatClosesIn as closesIn } from "@pm-amm/sdk/math";

export function resolvedLabel(winningSide: number): string {
  return winningSide === 1 ? "Resolved: YES" : winningSide === 2 ? "Resolved: NO" : "Resolved";
}

/** "YES 34¢ · NO 66¢ · closes in 3d" (or the resolution). */
export function marketSummary(m: {
  price: number;
  endTs: number;
  resolved: boolean;
  winningSide: number;
}): string {
  if (m.resolved) return resolvedLabel(m.winningSide);
  return `YES ${cents(m.price)} · NO ${cents(1 - m.price)} · ${closesIn(m.endTs)}`;
}

export function absoluteUrl(path: string): string {
  return new URL(path, BRAND.siteUrl).toString();
}

export const marketPath = (marketId: number | string) => `/market/${marketId}`;
export const groupPath = (groupId: number | string) => `/group/${groupId}`;

/** X web intent — opens the composer with text + link prefilled. */
export function xIntentUrl(text: string, url: string): string {
  const q = new URLSearchParams({ text, url });
  return `https://x.com/intent/post?${q.toString()}`;
}

/** Keep posts comfortably under X's limit (the URL counts as ~23 chars). */
export function clip(s: string, max = 200): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export interface TradeShare {
  mode: "buy" | "sell";
  side: "yes" | "no";
  /** YES-side probability at trade time. */
  price: number;
  question: string;
  /** Only included when the user opts in ("show amount"). */
  amount?: { value: number; symbol: string };
}

/** Post-trade copy: side + price; never a wallet address, amount only if opted in. */
export function tradeShareText(t: TradeShare): string {
  const sidePrice = cents(t.side === "yes" ? t.price : 1 - t.price);
  const what = t.amount
    ? `${t.amount.value} ${t.amount.symbol} of ${t.side.toUpperCase()}`
    : t.side.toUpperCase();
  const verb = t.mode === "buy" ? "I'm buying" : "I'm selling";
  return clip(`${verb} ${what} at ${sidePrice} on: ${t.question}`);
}

export type BuySide = "yes" | "no";
export const DEFAULT_BUY_USDC = 5;
const MAX_BUY_USDC = 10_000;

/** One-tap buy link: opens the market with the trade panel pre-filled. */
export function buyPath(marketId: number | string, side: BuySide, amount = DEFAULT_BUY_USDC) {
  return `${marketPath(marketId)}?buy=${side}&amount=${amount}`;
}

/**
 * Reads `?buy=yes|no&amount=N` from a query string. Invalid sides → null;
 * missing / invalid amounts fall back to the default. Never auto-submits —
 * the user still reviews and signs in their wallet.
 */
export function parseBuyIntent(search: string): { side: BuySide; amount: number } | null {
  const q = new URLSearchParams(search);
  const side = q.get("buy")?.toLowerCase();
  if (side !== "yes" && side !== "no") return null;
  const raw = q.get("amount") ?? "";
  const n = /^\d{1,6}(\.\d{1,2})?$/.test(raw) ? Number(raw) : NaN;
  const amount = n > 0 && n <= MAX_BUY_USDC ? n : DEFAULT_BUY_USDC;
  return { side, amount };
}
