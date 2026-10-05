/**
 * Money commands, parsed by fixed rules only (Claude never decides a trade):
 *
 *   buy YES $5 [#<id>]        buy NO 10        buy $5 yes
 *   sell YES [$3 | all]       stake YES $10    (in a bet thread)
 *   balance                   (also: bal, wallet, positions, portfolio)
 *   withdraw $20 to <address> withdraw all to <address>
 *
 * Anything unclear (no side, no amount on a buy) returns a `help` command so
 * the bot asks instead of guessing.
 */
export type Side = "yes" | "no";

export type MoneyCommand =
  | {
      kind: "trade";
      action: "buy" | "sell" | "stake";
      side: Side;
      /** USD amount; null on a sell means "all". */
      usd: number | null;
      /** Inline market / bet id ("#123456"), else from the thread. */
      ref: string | null;
    }
  | { kind: "balance" }
  | { kind: "withdraw"; usd: number | null; to: string }
  | { kind: "money-help"; text: string };

const TRADE = new Set(["buy", "sell", "stake"]);
const BALANCE = new Set(["balance", "bal", "wallet", "positions", "portfolio"]);
const ADDRESS = /\b([1-9A-HJ-NP-Za-km-z]{32,44})\b/;
/** "$5", "5", "5.50", "$5 usdc" — the first plain number in the text. */
const AMOUNT =
  /(?:^|\s)\$?\s?(\d{1,6}(?:\.\d{1,2})?)(?:\s*(?:usdc|usd|dollars?|bucks))?(?=\s|$|[.!?,])/i;

export const BUY_HELP = 'Say it like "buy YES $5" (or NO), as a reply under the market.';

function sideOf(text: string): Side | null {
  const yes = /\byes\b/i.test(text);
  const no = /\bno\b/i.test(text);
  return yes === no ? null : yes ? "yes" : "no";
}

function parseTrade(verb: "buy" | "sell" | "stake", rest: string): MoneyCommand {
  const ref = rest.match(/#(\d{1,16})\b/)?.[1] ?? null;
  const body = rest.replace(/#\d{1,16}\b/, " ");
  const side = sideOf(body);
  if (!side) return { kind: "money-help", text: BUY_HELP };
  const amt = body.match(AMOUNT)?.[1];
  const usd = amt ? Number(amt) : null;
  if (verb !== "sell" && !(usd && usd > 0)) {
    return { kind: "money-help", text: `How much? e.g. "${verb} ${side.toUpperCase()} $5".` };
  }
  return { kind: "trade", action: verb, side, usd: usd && usd > 0 ? usd : null, ref };
}

function parseWithdraw(rest: string): MoneyCommand {
  const to = rest.match(ADDRESS)?.[1];
  const usd = /\ball\b/i.test(rest) ? null : Number(rest.replace(ADDRESS, " ").match(AMOUNT)?.[1]);
  if (!to || (usd !== null && !(usd > 0))) {
    return {
      kind: "money-help",
      text: 'Say "withdraw $20 to <Solana address>" or "withdraw all to <address>".',
    };
  }
  return { kind: "withdraw", usd, to };
}

/** `body` is the mention without the leading @handles. Null → not a money command. */
export function parseMoney(body: string): MoneyCommand | null {
  const m = body.trim().match(/^([a-z]+)\b\s*([\s\S]*)$/i);
  if (!m) return null;
  const verb = m[1]!.toLowerCase();
  const rest = m[2]!.trim();
  if (TRADE.has(verb)) return parseTrade(verb as "buy" | "sell" | "stake", rest);
  if (BALANCE.has(verb) && rest.length < 20) return { kind: "balance" };
  if (verb === "withdraw") return parseWithdraw(rest);
  return null;
}

/**
 * "…I'll take YES $10" inside a `bet?` reply: the caller also stakes. Needs a
 * side next to a dollar amount, so "bet? by Oct 20" never stakes anything.
 */
export function stakeInBet(text: string): { side: Side; usd: number } | null {
  const a = text.match(/\b(yes|no)\b\s*(?:for|at|with)?\s*\$\s?(\d{1,6}(?:\.\d{1,2})?)/i);
  const b = text.match(/\$\s?(\d{1,6}(?:\.\d{1,2})?)\s*(?:on|for)?\s*\b(yes|no)\b/i);
  if (a) return { side: a[1]!.toLowerCase() as Side, usd: Number(a[2]) };
  if (b) return { side: b[2]!.toLowerCase() as Side, usd: Number(b[1]) };
  return null;
}
