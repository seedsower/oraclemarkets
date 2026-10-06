import type { BetVaultRow, Store } from "./store";
import { resolveTarget } from "./money";
import type { Mention } from "./xapi";

/**
 * Players call a bet's result; the resolver confirms. The bot only RECORDS
 * calls — it holds no resolution key (the bet's resolver is the admin wallet,
 * which signs in /admin). After the deadline:
 *
 *   @bot resolve YES | NO     a party proposes the result
 *   @bot dispute              a party objects
 *
 * Ready for the resolver when two parties agree, or one party called it and
 * nobody disputed within 24h. Conflicting calls or a dispute → "disputed",
 * the resolver decides. Parties: whoever called the bet, the take's author,
 * and anyone who staked from their X wallet.
 *
 *   bet:calls   hash: bet vault pubkey → JSON CallRecord (the web's /admin reads it)
 */
export const DISPUTE_WINDOW_SECS = 24 * 3600;
const KEY = "bet:calls";

export type CallCommand = { kind: "call"; side: "yes" | "no" } | { kind: "dispute" };

export interface Call {
  side: "yes" | "no";
  handle: string;
  /** Unix seconds. */
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

const CALL_VERBS = /^(resolve|settle|result|outcome|call)\b[\s:]*(yes|no)\b/i;
const DISPUTE_VERBS = /^(dispute|disputed|disagree|appeal)\b/i;

/** `body` is the mention without the leading @handles. */
export function parseCall(body: string): CallCommand | null {
  const t = body.trim();
  const m = t.match(CALL_VERBS);
  if (m) return { kind: "call", side: m[2]!.toLowerCase() as "yes" | "no" };
  return DISPUTE_VERBS.test(t) ? { kind: "dispute" } : null;
}

/** Same rules as the web (app/src/lib/bet-calls.ts) — keep in sync. */
export function callStatus(r: CallRecord | null, now: number): CallStatus {
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

interface Meta {
  openedBy?: string | null;
  openerId?: string | null;
  takeAuthorId?: string | null;
  takeAuthor?: string | null;
}

/** Is this X user part of the bet? (caller, take author, or an X-wallet staker) */
async function isParty(store: Store, m: Mention, v: BetVaultRow): Promise<boolean> {
  const raw = await store.redis.get(`bets:meta:${v.vaultId}`);
  const meta = (raw ? JSON.parse(raw) : {}) as Meta;
  const handle = m.username.toLowerCase();
  if (meta.openerId === m.authorId || meta.takeAuthorId === m.authorId) return true;
  if (handle && [meta.openedBy, meta.takeAuthor].some((h) => h?.toLowerCase() === handle))
    return true;
  return (await store.redis.sismember(`xbot:open:${m.authorId}`, `b:${v.publicKey}`)) === 1;
}

/** The bet this thread is about (a launched bet's market link counts too). */
async function betOf(store: Store, m: Mention): Promise<BetVaultRow | null> {
  const t = await resolveTarget(store, m, null);
  if (t.kind === "bet") return t.bet;
  if (t.kind !== "market") return null;
  const bets = await store.betVaults();
  return bets.find((b) => b.market === t.market.publicKey) ?? null;
}

const fmt = (ts: number) =>
  new Date(ts * 1000).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }) + " UTC";

/** Why this bet can't be called yet (or ever); null when it can. */
function notCallable(v: BetVaultRow, now: number): string | null {
  if (v.settled) return "This bet is already settled.";
  if (v.voided) return "This bet was voided; everyone gets refunded.";
  if (!v.launched) {
    return now < v.commitEndTs
      ? "Stakes are still open; call it after the deadline."
      : "This bet never launched; stakes are refunded.";
  }
  if (now < v.marketEndTs)
    return `Too early: the result can be called after ${fmt(v.marketEndTs)}.`;
  return null;
}

export async function handleCall(store: Store, m: Mention, cmd: CallCommand): Promise<string> {
  const v = await betOf(store, m);
  if (!v) return "Which bet? Reply under the bet (or its market post) to call the result.";
  const now = Math.floor(Date.now() / 1000);
  const blocked = notCallable(v, now);
  if (blocked) return blocked;
  if (!(await isParty(store, m, v))) {
    return "Only people in this bet can call it: whoever called it, the take's author, or someone who staked.";
  }
  const raw = await store.redis.hget(KEY, v.publicKey);
  const rec: CallRecord = raw ? JSON.parse(raw) : { calls: {}, disputes: {} };
  if (cmd.kind === "call") rec.calls[m.authorId] = { side: cmd.side, handle: m.username, at: now };
  else rec.disputes[m.authorId] = { handle: m.username, at: now };
  await store.redis.hset(KEY, v.publicKey, JSON.stringify(rec));
  return callReply(m.username, cmd, callStatus(rec, now));
}

export function callReply(handle: string, cmd: CallCommand, s: CallStatus): string {
  if (cmd.kind === "dispute" || s.kind === "disputed") {
    return cmd.kind === "dispute"
      ? "Disputed. The resolver will look at it and decide."
      : `Noted @${handle}, but the calls don't match, so it's marked disputed. The resolver will decide.`;
  }
  const side = cmd.side.toUpperCase();
  if (s.kind === "ready" && s.why === "agreed") {
    return `Both sides say ${side}. Sent to the resolver to confirm; payouts follow automatically.`;
  }
  return `Noted: @${handle} says ${side}. Anyone in this bet who disagrees can reply "dispute" (tag me) within 24h. Then the resolver confirms.`;
}
