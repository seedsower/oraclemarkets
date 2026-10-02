import { hasTopic, stripMentions, type Command } from "./commands";
import type { BetsConfig } from "./config";
import type { Mention } from "./xapi";

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
  return stripMentions(text)
    .replace(/@\w{1,15}/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const fmtDate = (d: Date) =>
  d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export type BetPlan =
  | { action: "reply"; text: string }
  | {
      action: "open";
      question: string;
      name: string;
      deadline: Date;
      marketDurationSecs: number;
      /** Dedupe key: the take's post id (or the mention itself for inline questions). */
      sourceId: string;
      sourceUrl: string | null;
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
  const closes = now + cfg.stakeWindowSecs;
  const earliest = new Date((closes + MIN_MARKET_SECS) * 1000);
  const latest = new Date((closes + MAX_MARKET_SECS) * 1000);
  if (!cmd.deadline) {
    return {
      action: "reply",
      text: `Add a deadline so it can be settled: "bet? by <date>" — any day up to ${fmtDate(latest)}.`,
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
      text: `Pick a deadline between ${fmtDate(earliest)} and ${fmtDate(latest)} — bets run up to 30 days after staking closes.`,
    };
  }
  const fromParent = cmd.question === null && m.parent !== null;
  return {
    action: "open",
    question,
    name: clipBytes(question),
    deadline,
    marketDurationSecs: secs,
    sourceId: fromParent ? m.parent!.id : m.id,
    sourceUrl: fromParent
      ? `https://x.com/${m.parent!.username || "i"}/status/${m.parent!.id}`
      : `https://x.com/${m.username || "i"}/status/${m.id}`,
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
export const BET_RETRY_REPLY = "Couldn't open that bet just now. Tag me again in a few minutes.";
