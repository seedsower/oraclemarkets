/**
 * Deterministic command parsing for mentions (no LLM). Anything that isn't a
 * recognised command returns null → the bot stays silent (no spam).
 *
 *   @bot odds <market id | search words>
 *   @bot markets        (or: trending)
 *   @bot propose <question> by <date>
 */
export type Command =
  | { kind: "odds"; query: string }
  | { kind: "markets" }
  | { kind: "propose"; question: string; by: string; deadline: Date | null };

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

export function parseCommand(text: string, now = new Date()): Command | null {
  const body = stripMentions(text);
  const m = body.match(/^([a-z]+)\b\s*([\s\S]*)$/i);
  if (!m) return null;
  const verb = m[1]!.toLowerCase();
  const rest = m[2]!.trim();
  if (verb === "odds") return rest ? { kind: "odds", query: rest.slice(0, 100) } : null;
  if (verb === "markets" || verb === "trending")
    return rest.length < 40 ? { kind: "markets" } : null;
  if (verb === "propose") return parsePropose(rest, now);
  return null;
}
