/**
 * Players' result calls on bets from X (`@bot resolve YES` / `@bot dispute`),
 * recorded by the X bot in Redis hash `bet:calls` (vault → CallRecord). The
 * resolver still signs; this only tells the admin what the players say.
 * Same rules as workers/xbot/src/calls.ts — keep in sync.
 */
export const DISPUTE_WINDOW_SECS = 24 * 3600;

export interface Call {
  side: "yes" | "no";
  handle: string;
  at: number;
}
export interface CallRecord {
  calls: Record<string, Call>;
  disputes: Record<string, { handle: string; at: number }>;
}
export type CallStatus =
  | { kind: "none" }
  | { kind: "pending"; side: "yes" | "no"; readyAt: number }
  | { kind: "ready"; side: "yes" | "no"; why: "agreed" | "uncontested" }
  | { kind: "disputed" };

export function callStatus(r: CallRecord | null | undefined, now: number): CallStatus {
  const calls = Object.values(r?.calls ?? {});
  const disputed = Object.keys(r?.disputes ?? {}).length > 0;
  if (!calls.length) return disputed ? { kind: "disputed" } : { kind: "none" };
  const side = calls[0]!.side;
  if (disputed || calls.some((c) => c.side !== side)) return { kind: "disputed" };
  if (calls.length >= 2) return { kind: "ready", side, why: "agreed" };
  const readyAt = calls[0]!.at + DISPUTE_WINDOW_SECS;
  return now >= readyAt
    ? { kind: "ready", side, why: "uncontested" }
    : { kind: "pending", side, readyAt };
}

/** Sort key for the admin list: ready first, then disputed, pending, none. */
export const STATUS_ORDER: Record<CallStatus["kind"], number> = {
  ready: 0,
  disputed: 1,
  pending: 2,
  none: 3,
};
