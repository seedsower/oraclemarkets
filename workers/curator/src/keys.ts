/**
 * Curator state in the shared Redis (same instance as web, keeper, xbot).
 *
 *   ai:link:question:<questionId>  → market pubkey (idempotency: one market per question)
 *   ai:link:market:<pubkey>        → partner question id
 *   market:meta:<pubkey>           JSON MarketMeta (full title, criteria, partner URL, attribution)
 *   market:source                  hash pubkey → "oraclemarkets.io" (for a "From the Oracle" list)
 *   categories                     hash pubkey → app category slug (same hash /api/categories serves)
 *   curator:pending                hash questionId → {marketId, market, at}, written BEFORE a
 *                                  creation is sent, so a crash between confirm and link can't
 *                                  produce a second market (reconcile() finishes it next run)
 *   curator:titles                 hash questionId → vetted ≤ 64-byte title (saves Claude calls)
 *   curator:featured               set of pubkeys currently in a category's top N
 */
export const K = {
  link: (questionId: string) => `ai:link:question:${questionId}`,
  linkMarket: (market: string) => `ai:link:market:${market}`,
  meta: (market: string) => `market:meta:${market}`,
  source: "market:source",
  categories: "categories",
  pending: "curator:pending",
  titles: "curator:titles",
  featured: "curator:featured",
} as const;

export const SOURCE = "oraclemarkets.io";
