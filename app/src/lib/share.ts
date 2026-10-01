import { BRAND } from "@/lib/brand";

/**
 * Pure copy/URL helpers for share cards, metadata and "Share on X" — used by
 * server (OG images, generateMetadata) and client (buttons, toasts).
 */

/** Probability → cents label: 0.342 → "34¢". */
export function cents(p: number): string {
  if (p > 0 && p < 0.005) return "<1¢";
  if (p < 1 && p > 0.995) return ">99¢";
  return `${Math.round(p * 100)}¢`;
}

/** "closes in 3d" / "closes in 5h" / "closes in 12m" / "closed". */
export function closesIn(endTs: number, now = Math.floor(Date.now() / 1000)): string {
  const left = endTs - now;
  if (left <= 0) return "closed";
  if (left >= 86_400) return `closes in ${Math.floor(left / 86_400)}d`;
  if (left >= 3_600) return `closes in ${Math.floor(left / 3_600)}h`;
  return `closes in ${Math.max(1, Math.floor(left / 60))}m`;
}

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

/** Leg markets are named "<group question> - <outcome>"; show just the outcome. */
export function legLabel(name: string): string {
  return name.split(" - ").slice(-1)[0] || name;
}
