import type { ReactNode } from "react";
import { BRAND } from "@/lib/brand";

/**
 * A static X thread showing the bot at work: a take, someone calls `bet?`,
 * the bot opens the market, the other side stakes by replying. Pure markup —
 * no chain reads, no wallet.
 */
const BOT = `@${(BRAND.xHandle ?? "daotao23").replace(/^@/, "")}`;

function Avatar({ letter, bot = false }: { letter: string; bot?: boolean }) {
  return (
    <div
      className={`w-[36px] h-[36px] rounded-full shrink-0 flex items-center justify-center text-[14px] font-medium ${
        bot
          ? "bg-accent-soft border border-accent/60 text-accent"
          : "bg-surface-2 border border-line-2 text-text-dim"
      }`}
    >
      {bot ? (
        <span className="w-[13px] h-[13px] rounded-full border-[2.5px] border-accent" />
      ) : (
        letter
      )}
    </div>
  );
}

function Post(props: {
  name: string;
  handle: string;
  time: string;
  bot?: boolean;
  last?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex gap-[12px]">
      <div className="flex flex-col items-center">
        <Avatar letter={props.name[0]!} bot={props.bot} />
        {!props.last && <div className="w-[2px] flex-1 bg-line-2 my-[4px]" />}
      </div>
      <div className={`flex-1 min-w-0 ${props.last ? "" : "pb-[18px]"}`}>
        <div className="flex items-baseline gap-[6px] text-[13px]">
          <span className="text-text-hi font-medium">{props.name}</span>
          {props.bot && (
            <span className="font-mono text-[9px] tracking-[0.08em] text-accent border border-accent/40 rounded-sm px-[4px]">
              BOT
            </span>
          )}
          <span className="text-muted truncate">
            {props.handle} · {props.time}
          </span>
        </div>
        <div className="mt-[4px] text-[14px] leading-[1.45] text-text">{props.children}</div>
      </div>
    </div>
  );
}

const Tag = ({ children }: { children: ReactNode }) => (
  <span className="text-accent">{children}</span>
);
const Link = ({ children }: { children: ReactNode }) => (
  <span className="text-accent underline underline-offset-2 decoration-accent/40">{children}</span>
);

export function ThreadMock() {
  return (
    <div className="w-full max-w-[440px] rounded-2xl border border-line-2 bg-surface/70 p-[18px] shadow-[0_24px_60px_-28px_rgba(0,0,0,0.6)]">
      <Post name="Maya" handle="@maya_sol" time="2h">
        SOL flips ETH by market cap before Halloween. Not even close.
      </Post>
      <Post name="Dev" handle="@devbuilds" time="1h">
        <Tag>{BOT}</Tag>
        {" bet? by Oct 31, I'll take NO $10"}
      </Post>
      <Post name="Oracle Markets" handle={BOT} time="1h" bot>
        Bet&apos;s open: &quot;Will SOL&apos;s market cap pass ETH&apos;s by Oct 31?&quot;
        <br />
        Stake YES or NO in the next 1h. Resolves Oct 31.
        <br />
        YES: <Link>oraclemarkets.app/bet/…</Link>
        <br />
        <span className="text-no">You&apos;re in: NO $10.</span>
      </Post>
      <Post name="Maya" handle="@maya_sol" time="58m">
        <Tag>{BOT}</Tag>
        {" stake YES $10"}
      </Post>
      <Post name="Oracle Markets" handle={BOT} time="58m" bot last>
        New here: your wallet has $50 test USDC.{" "}
        <span className="text-yes">Staked $10 on YES.</span> Balance $40.
      </Post>
    </div>
  );
}
