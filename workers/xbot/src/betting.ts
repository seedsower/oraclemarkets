import { hasTopic, parseCommand, stripMentions, takeCategory, type Command } from "./commands";
import type { Refined } from "./claude";
import type { BetsConfig } from "./config";
import type { Mention, ParentPost } from "./xapi";

/**
 * `bet?` → a Bet Vault on the take. Pure planning + reply copy (tested);
 * the on-chain side lives in bet-actions.ts.
 */
type BetCmd = Extract<Command, { kind: "bet" }>;

const DAY = 86_400;
/** Bet Vault v2 bound: the market runs at most 30 days after staking closes. */
const MAX_MARKET_SECS = 30 * DAY;
/** Leave at least an hour of trading after staking closes. */
const MIN_MARKET_SECS = 3600;
export const STAKE_USDC = 10;
/** Per-bet staking windows ("in 30m"): 15 minutes to the program's 7-day max. */
export const MIN_WINDOW_SECS = 15 * 60;
export const MAX_WINDOW_SECS = 7 * DAY;

/** UTF-8 safe clip to `max` BYTES (on-chain names are ≤ 64 bytes). */
export function clipBytes(s: string, max = 64): string {
  const enc = new TextEncoder();
  if (enc.encode(s).length <= max) return s;
  let out = "";
  for (const ch of s) {
    if (enc.encode(out + ch + "…").length > max) break;
    out += ch;
  }
  return `${out.trimEnd()}…`;
}

/** A post's text as a question: no @handles, links, or extra whitespace. */
export function cleanTake(text: string): string {
  return takeCategory(stripMentions(text))
    .rest.replace(/@\w{1,15}/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const fmtDate = (d: Date) =>
  d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/**
 * A bet the bot asked a follow-up about ("pick a deadline"), remembered under
 * the bot's reply id so an answer like "Oct 4" opens it on the original take.
 */
export interface PendingBet {
  /** The take (null when the question was written inline). */
  take: ParentPost | null;
  question: string | null;
  windowSecs: number | null;
  category: string | null;
}

const pendingFrom = (cmd: BetCmd, m: Mention): PendingBet => ({
  take: cmd.question ? null : m.parent,
  question: cmd.question,
  windowSecs: cmd.windowSecs,
  category: cmd.category,
});

/**
 * An answer to the bot's follow-up ("Oct 4", "Nov 1 in 2h #weather"): the
 * date/window/hashtag come from the answer, the question from the original.
 */
export function followUpCommand(text: string, p: PendingBet, now = new Date()): BetCmd {
  const body = stripMentions(text);
  const direct = parseCommand(text, now);
  const parsed =
    direct?.kind === "bet" ? direct : parseCommand(body ? `bet? by ${body}` : "bet?", now);
  const c = parsed as BetCmd; // "bet? …" always parses as a bet
  return {
    ...c,
    question: p.question,
    windowSecs: c.windowSecs ?? p.windowSecs,
    category: c.category ?? p.category,
  };
}

export type BetPlan =
  | { action: "reply"; text: string; pending?: PendingBet }
  | {
      action: "open";
      question: string;
      name: string;
      deadline: Date;
      /** How long staking stays open (the default or the bet's "in 1h"). */
      windowSecs: number;
      marketDurationSecs: number;
      /** Dedupe key: the take's post id (or the mention itself for inline questions). */
      sourceId: string;
      sourceUrl: string | null;
      /** From the reply's hashtag, else the take's (#crypto …); null → none. */
      category: string | null;
    };

/** Validate a `bet?` mention: needs a take and a deadline inside the program's bounds. */
export function planBet(cmd: BetCmd, m: Mention, cfg: BetsConfig, now: number): BetPlan {
  const question = cmd.question ?? (m.parent ? cleanTake(m.parent.text) : null);
  if (!question || !hasTopic(question)) {
    return {
      action: "reply",
      text: `Reply "bet? by <date>" under the take you want to bet on, or write it out: "bet <question> by <date>".`,
    };
  }
  const windowSecs = cmd.windowSecs ?? cfg.stakeWindowSecs;
  if (windowSecs < MIN_WINDOW_SECS || windowSecs > MAX_WINDOW_SECS) {
    return {
      action: "reply",
      text: `Staking can stay open from 15m to 7d, e.g. "bet? by <date> in 1h".`,
      pending: { ...pendingFrom(cmd, m), windowSecs: null },
    };
  }
  const closes = now + windowSecs;
  const earliest = new Date((closes + MIN_MARKET_SECS) * 1000);
  const latest = new Date((closes + MAX_MARKET_SECS) * 1000);
  if (!cmd.deadline) {
    return {
      action: "reply",
      text: `Add a deadline so it can be settled: reply with a date up to ${fmtDate(latest)}.`,
      pending: pendingFrom(cmd, m),
    };
  }
  // A bare date means the END of that day (UTC).
  const deadline = new Date(
    cmd.deadline.getTime() + (cmd.deadline.getUTCHours() === 0 ? DAY * 1000 - 1000 : 0),
  );
  const secs = Math.floor(deadline.getTime() / 1000) - closes;
  if (secs < MIN_MARKET_SECS || secs > MAX_MARKET_SECS) {
    return {
      action: "reply",
      text: `Pick a deadline between ${fmtDate(earliest)} and ${fmtDate(latest)} (bets run up to 30 days after staking closes): reply with a date.`,
      pending: pendingFrom(cmd, m),
    };
  }
  const fromParent = cmd.question === null && m.parent !== null;
  const category = cmd.category ?? (m.parent ? takeCategory(m.parent.text).category : null);
  return {
    action: "open",
    question,
    name: clipBytes(question),
    deadline,
    windowSecs,
    marketDurationSecs: secs,
    sourceId: fromParent ? m.parent!.id : m.id,
    category,
    sourceUrl: fromParent
      ? `https://x.com/${m.parent!.username || "i"}/status/${m.parent!.id}`
      : `https://x.com/${m.username || "i"}/status/${m.id}`,
  };
}

type OpenPlan = Extract<BetPlan, { action: "open" }>;

/** Claude's question + rules replace the raw take; a hashtag still wins the category. */
export function applyRefinement(
  plan: OpenPlan,
  r: Refined | null,
): OpenPlan & { take: string; rules: string | null } {
  if (!r?.allowed) return { ...plan, take: plan.question, rules: null };
  return {
    ...plan,
    take: plan.question,
    question: r.name,
    name: clipBytes(r.name),
    rules: r.rules,
    category: plan.category ?? r.category,
  };
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function stakeLinks(site: string, vaultId: number | string): string {
  const url = `${site}/bet/${vaultId}`;
  return `YES: ${url}?buy=yes&amount=${STAKE_USDC}\nNO: ${url}?buy=no&amount=${STAKE_USDC}`;
}

/** "24h", "90m" — how long staking stays open. */
export function windowLabel(secs: number): string {
  return secs >= 3600 ? `${Math.round(secs / 3600)}h` : `${Math.max(1, Math.round(secs / 60))}m`;
}

export function betOpenedReply(
  question: string,
  vaultId: number | string,
  deadline: Date,
  stakeWindow: string,
  site: string,
): string {
  return (
    `Bet's open: "${clip(question, 90)}"\n` +
    `Stake YES or NO in the next ${stakeWindow}. The pot sets the odds. Resolves ${fmtDate(deadline)}.\n` +
    stakeLinks(site, vaultId)
  );
}

export function betExistingReply(vaultId: string, site: string): string {
  return `There's already a bet on this take:\n${stakeLinks(site, vaultId)}`;
}

export const BETS_OFF_REPLY = "Bets from X aren't switched on yet. Stay tuned.";
export const BETS_BUSY_REPLY = "The bet desk is at its limit for today. Try again tomorrow.";
export const BET_REFUSED_REPLY = "I can't open a bet on that one. Try a different take.";
export const BET_RETRY_REPLY = "Couldn't open that bet just now. Tag me again in a few minutes.";
