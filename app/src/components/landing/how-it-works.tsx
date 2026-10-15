import { BRAND } from "@/lib/brand";

/**
 * The four steps of a bet from X, plus the full command reference. Copy only
 * describes what the X bot actually does (workers/xbot).
 */
const BOT = BRAND.xAt;

const STEPS: { n: string; title: string; reply: string; body: string }[] = [
  {
    n: "01",
    title: "Call it",
    reply: "bet? by Oct 31",
    body: 'Reply under any take and tag the bot. Add a deadline, and optionally your side: "I\'ll take YES $10". Add a #crypto or #sports tag to file it.',
  },
  {
    n: "02",
    title: "The bot opens a market",
    reply: "Bet's open: …",
    body: "Claude turns the take into a clear yes/no question with resolution rules, then the bot opens the market on Solana and replies with the details.",
  },
  {
    n: "03",
    title: "Take sides, from X",
    reply: "stake YES $10",
    body: "Anyone in the thread stakes or trades by replying. Your first command creates a wallet tied to your X account with $50 of test USDC.",
  },
  {
    n: "04",
    title: "Settle and get paid",
    reply: "resolve YES",
    body: "After the deadline, the people in the bet call the result (or dispute it). The resolver confirms, and winnings land in your wallet automatically.",
  },
];

export function HowItWorks() {
  return (
    <ol className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-[12px]">
      {STEPS.map((s) => (
        <li
          key={s.n}
          className="rounded-xl border border-line bg-surface/40 p-[20px] flex flex-col gap-[12px]"
        >
          <span className="font-mono text-[11px] text-accent">{s.n}</span>
          <h3 className="text-[18px] tracking-[-0.01em] text-text-hi">{s.title}</h3>
          <code className="self-start font-mono text-[12px] text-accent bg-accent-soft rounded-md px-[8px] py-[4px]">
            {s.reply.startsWith("Bet's") ? s.reply : `${BOT} ${s.reply}`}
          </code>
          <p className="text-[13px] leading-[1.6] text-text-dim">{s.body}</p>
        </li>
      ))}
    </ol>
  );
}

const COMMANDS: { cmd: string; what: string }[] = [
  { cmd: "bet? by <date>", what: "Open a bet on the take you're replying to" },
  { cmd: "bet? by <date> in 2h", what: "…and keep stakes open for 2 hours (default 1h)" },
  { cmd: "stake YES $10", what: "Back a side of a bet that's taking stakes" },
  { cmd: "buy YES $5", what: "Buy shares under any market post (or NO)" },
  { cmd: "sell YES", what: "Sell all your YES shares (or sell YES $3)" },
  { cmd: "balance", what: "Your cash and open positions" },
  { cmd: "withdraw $20 to <address>", what: "Send USDC to any Solana wallet" },
  { cmd: "resolve YES", what: "After the deadline: call the result (people in the bet)" },
  { cmd: "dispute", what: "Disagree with a call; the resolver decides" },
  { cmd: "odds <topic>", what: "Get a market's current odds" },
];

export function CommandReference() {
  return (
    <div className="rounded-xl border border-line overflow-hidden">
      {COMMANDS.map((c, i) => (
        <div
          key={c.cmd}
          className={`grid grid-cols-1 sm:grid-cols-[minmax(0,320px)_1fr] gap-x-[24px] gap-y-[2px] px-[18px] py-[12px] ${
            i % 2 ? "bg-surface/30" : "bg-surface/60"
          }`}
        >
          <code className="font-mono text-[13px] text-accent break-words">
            {BOT} {c.cmd}
          </code>
          <span className="text-[13px] text-text-dim">{c.what}</span>
        </div>
      ))}
    </div>
  );
}
