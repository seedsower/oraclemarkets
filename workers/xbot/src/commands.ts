/**
 * Deterministic parsing of mentions (rules only, no LLM).
 *
 *   @bot odds <market id | words>        (also: odd, ods, price, chance…)
 *   @bot markets                         (also: market, trending, top, hot)
 *   @bot propose <question> by <date>    (also: suggest, idea)
 *   @bot <plain question or topic>       → "question": matched to a market
 *
 * Small talk ("gm", "thanks", "love this") returns null → no reply.
 */
export type Command =
  | { kind: "odds"; query: string }
  | { kind: "markets" }
  | { kind: "propose"; question: string; by: string; deadline: Date | null }
  /** Free text: answer with a matching market, else a hint (or save a "will … by <date>"). */
  | { kind: "question"; query: string; isWill: boolean }
  /**
   * "bet? by <date>" (the take is the post being replied to / quoted) or
   * "bet <question> by <date>". Missing pieces are null — the bot asks for them.
   */
  | { kind: "bet"; question: string | null; by: string | null; deadline: Date | null };

const ODDS = new Set([
  "odds",
  "odd",
  "ods",
  "oods",
  "odss",
  "price",
  "prices",
  "chance",
  "chances",
  "prob",
  "probability",
]);
const MARKETS = new Set(["markets", "market", "trending", "trend", "top", "hot", "list"]);
const PROPOSE = new Set(["propose", "proposal", "suggest", "suggestion", "idea"]);

/** Words that carry no topic — a mention made only of these is small talk. */
const SMALL_TALK = new Set([
  "gm",
  "gn",
  "hi",
  "hey",
  "hello",
  "yo",
  "sup",
  "thanks",
  "thank",
  "you",
  "ty",
  "thx",
  "lol",
  "lmao",
  "love",
  "this",
  "it",
  "nice",
  "cool",
  "wow",
  "great",
  "good",
  "morning",
  "night",
  "bro",
  "fam",
  "ser",
  "sir",
  "please",
  "pls",
  "plz",
  "what",
  "are",
  "the",
  "odds",
  "is",
  "a",
  "an",
  "of",
  "on",
  "for",
  "to",
  "and",
  "or",
  "how",
  "do",
  "does",
  "can",
  "i",
  "me",
  "my",
  "we",
  "us",
  "so",
  "ok",
  "okay",
]);

/** At least one word that could name a market topic (not small talk). */
export function hasTopic(text: string): boolean {
  return text
    .toLowerCase()
    .split(/[^a-z0-9$%]+/)
    .some((w) => w.length >= 2 && !SMALL_TALK.has(w));
}

const MAX_QUESTION = 140;

/** Drop the leading run of @handles (the reply chain X prepends) and URLs. */
export function stripMentions(text: string): string {
  return text
    .replace(/^(\s*@\w{1,15})+/, "")
    .replace(/https?:\/\/\S+/g, "")
    .trim();
}

const LOOKS_LIKE_DATE =
  /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}[/.-]\d{1,2}([/.-]\d{2,4})?\b/i;

/** Parse "Dec 31", "2026-12-31", "December 31, 2026"; null when unclear. */
export function parseDeadline(raw: string, now = new Date()): Date | null {
  const cleaned = raw.trim().replace(/[?.!]+$/, "");
  // Date.parse is lenient ("whenever 2026" → Jan 1), so require something that
  // actually looks like a date: a month name, or a numeric d/m or ISO date.
  if (!LOOKS_LIKE_DATE.test(cleaned)) return null;
  const withYear = /\d{4}/.test(cleaned) ? cleaned : `${cleaned} ${now.getUTCFullYear()}`;
  const t = Date.parse(`${withYear} UTC`) || Date.parse(withYear);
  if (!Number.isFinite(t)) return null;
  let d = new Date(t);
  // A bare month ("december", "Dec 2026") means the END of that month.
  if (/^[a-z]+\.?(\s+\d{4})?$/i.test(cleaned)) {
    d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  }
  // "Jan 5" written in December means next year.
  if (!/\d{4}/.test(cleaned) && d.getTime() < now.getTime()) {
    d = new Date(Date.UTC(d.getUTCFullYear() + 1, d.getUTCMonth(), d.getUTCDate()));
  }
  return d;
}

function parsePropose(rest: string, now: Date): Command | null {
  // Split on the LAST " by " so questions may contain "by" themselves.
  const i = rest.toLowerCase().lastIndexOf(" by ");
  if (i <= 0) return null;
  const question = rest.slice(0, i).trim().replace(/\s+/g, " ");
  const by = rest.slice(i + 4).trim();
  if (question.length < 8 || question.length > MAX_QUESTION || !by) return null;
  return { kind: "propose", question, by, deadline: parseDeadline(by, now) };
}

/** "? by Dec 31" | "Will X happen by Dec 31" | "" → question and deadline parts. */
function parseBet(rest: string, now: Date): Command {
  const body = rest.replace(/^[?!.\s]+/, "").trim();
  let question: string | null = body || null;
  let by: string | null = null;
  if (/^by\s+/i.test(body)) {
    question = null;
    by = body.replace(/^by\s+/i, "");
  } else {
    const i = body.toLowerCase().lastIndexOf(" by ");
    if (i > 0) {
      question = body.slice(0, i).trim() || null;
      by = body.slice(i + 4).trim() || null;
    }
  }
  // "bet? on it" / "bet ser" carry no question of their own.
  if (question && !hasTopic(question)) question = null;
  return { kind: "bet", question, by, deadline: by ? parseDeadline(by, now) : null };
}

export function parseCommand(text: string, now = new Date()): Command | null {
  const body = stripMentions(text);
  const m = body.match(/^([a-z']+)\b\s*([\s\S]*)$/i);
  if (!m) return null;
  const verb = m[1]!.toLowerCase().replace(/'s$/, "");
  const rest = m[2]!.trim();
  if (ODDS.has(verb) && hasTopic(rest)) return { kind: "odds", query: rest.slice(0, 100) };
  if (MARKETS.has(verb) && rest.length < 40) return { kind: "markets" };
  if (PROPOSE.has(verb)) return parsePropose(rest, now);
  if (verb === "bet" || verb === "bets") return parseBet(rest, now);
  // "what are the odds on sol?" → treat the whole thing as a question.
  if (!hasTopic(body)) return null;
  const isWill =
    /^(will|would|is|are|does|do|can|could|should|when|what|how)\b/i.test(body) ||
    body.endsWith("?");
  return { kind: "question", query: body.slice(0, 100), isWill };
}
