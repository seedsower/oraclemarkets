import Link from "next/link";
import { LandingNav } from "@/components/layout/landing-nav";
import { CopyCommand } from "@/components/ui/copy-command";
import { BRAND, ENGINE } from "@/lib/brand";
import { CLUSTER } from "@/lib/constants";
import { CommandReference, HowItWorks } from "@/components/landing/how-it-works";
import { ThreadMock } from "@/components/landing/thread-mock";

const CLUSTER_LABEL =
  CLUSTER === "mainnet-beta" ? "Mainnet" : CLUSTER === "devnet" ? "Devnet" : "Localnet";
const HANDLE = (BRAND.xHandle ?? "daotao23").replace(/^@/, "");
const BOT = `@${HANDLE}`;

const btn =
  "px-[18px] py-[11px] rounded-md font-mono text-[13px] tracking-[0.03em] transition-all duration-[120ms]";

/** Landing: the X bot. Every argument on X becomes a market, all by replying. */
export default function Home() {
  return (
    <div className="min-h-screen flex flex-col bg-bg">
      <LandingNav />

      {/* Hero */}
      <section className="px-[24px] md:px-[48px] pt-[56px] md:pt-[88px] pb-[72px] max-w-[1180px] mx-auto w-full grid grid-cols-1 lg:grid-cols-[1.05fr_0.95fr] gap-[48px] items-center">
        <div>
          <div className="inline-flex items-center gap-[8px] font-mono text-[10px] tracking-[0.12em] uppercase text-muted border border-line rounded-full px-[12px] py-[5px] mb-[28px]">
            <span className="w-[6px] h-[6px] rounded-full bg-yes" />
            {BOT} on 𝕏 · Solana · {CLUSTER_LABEL}
          </div>
          <h1 className="text-[40px] md:text-[60px] leading-[1.02] tracking-[-0.03em] text-text-hi font-medium max-w-[15ch]">
            Every argument on X is <span className="text-accent">now a market.</span>
          </h1>
          <p className="mt-[24px] text-[15px] md:text-[17px] leading-[1.6] text-text-dim max-w-[52ch]">
            Reply <code className="font-mono text-accent">{BOT} bet?</code> under any take. The bot
            opens a prediction market, gives everyone in the thread a wallet with $50 of test USDC,
            and pays the winner. Stake, trade and settle by replying, on any phone, without leaving
            X.
          </p>
          <div className="mt-[36px] flex flex-wrap items-center gap-[12px]">
            <a
              href={`https://x.com/${HANDLE}`}
              target="_blank"
              rel="noopener noreferrer"
              className={`${btn} bg-accent text-bg font-medium hover:brightness-110`}
            >
              Try it on 𝕏 ↗
            </a>
            <Link
              href="/markets"
              className={`${btn} border border-line-2 text-text-hi hover:bg-surface`}
            >
              Live markets
            </Link>
            <Link href="/wallet" className={`${btn} text-text-dim hover:text-text-hi`}>
              Your X wallet →
            </Link>
          </div>
        </div>
        <div className="flex justify-center lg:justify-end">
          <ThreadMock />
        </div>
      </section>

      {/* How it works */}
      <section
        id="how-it-works"
        className="px-[24px] md:px-[48px] pb-[80px] max-w-[1180px] mx-auto w-full scroll-mt-[24px]"
      >
        <div className="text-caption mb-[12px]">HOW IT WORKS</div>
        <h2 className="text-[26px] md:text-[34px] tracking-[-0.02em] text-text-hi leading-[1.1] mb-[32px] max-w-[26ch]">
          From a hot take to a payout, all in the replies.
        </h2>
        <HowItWorks />
      </section>

      {/* Commands */}
      <section className="px-[24px] md:px-[48px] pb-[80px] max-w-[1180px] mx-auto w-full">
        <div className="grid grid-cols-1 lg:grid-cols-[0.8fr_1.2fr] gap-[32px] items-start">
          <div>
            <div className="text-caption mb-[12px]">WHAT YOU CAN SAY</div>
            <h2 className="text-[26px] md:text-[32px] tracking-[-0.02em] text-text-hi leading-[1.1]">
              Tag the bot, say what you want.
            </h2>
            <p className="mt-[14px] text-[14px] leading-[1.6] text-text-dim max-w-[44ch]">
              Reply under a market or bet post and the bot knows which one you mean. Money commands
              follow strict rules, so it never guesses a trade: if something&apos;s unclear, it
              asks. Limits: $25 per trade, $100 a day.
            </p>
          </div>
          <CommandReference />
        </div>
      </section>

      {/* Why it works */}
      <section className="px-[24px] md:px-[48px] pb-[80px] max-w-[1180px] mx-auto w-full">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-[1px] bg-line border border-line rounded-xl overflow-hidden">
          <Pillar
            tag="Any phone"
            title="Just replies"
            body="No app, no extension, no wallet popups. If you can post on X, you can bet. The bot answers in the thread."
          />
          <Pillar
            tag="Your wallet"
            title="Take it with you"
            body="Sign in with X on the wallet page to see your balance and positions, or export the key to Phantom any time."
            href="/wallet"
          />
          <Pillar
            tag="Fair results"
            title="Players call it"
            body="People in the bet call the result and can dispute it. A resolver confirms, and every bet's rules are on its page."
          />
          <Pillar
            tag="Bragging rights"
            title="Leaderboard"
            body="Everyone who traded in the last 48 hours, on X or the site, ranked by profit."
            href="/leaderboard"
          />
        </div>
      </section>

      {/* Under the hood */}
      <section className="px-[24px] md:px-[48px] pb-[24px] max-w-[1180px] mx-auto w-full">
        <div className="text-caption mb-[12px]">UNDER THE HOOD</div>
        <p className="text-[15px] leading-[1.6] text-text-dim max-w-[70ch] mb-[14px]">
          Every bet is a real market on Solana (devnet, test USDC). Prefer your own wallet? Every
          market also trades on the site with Phantom, Solflare or Backpack.
        </p>
        <p className="text-[15px] leading-[1.6] text-text-dim max-w-[70ch]">
          Prices come from the{" "}
          <a
            href={ENGINE.paperUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-text-hi underline underline-offset-2 hover:text-accent"
          >
            Paradigm pm-AMM
          </a>{" "}
          (Moallemi &amp; Robinson, 2024), an AMM designed for prediction markets. Time-decaying
          liquidity <span className="font-mono text-text-hi">L_eff = L₀·√(T−t)</span> delivers
          uniform LVR across price <em>and</em> time, with continuous LP yield, plus
          crowd-bootstrapped markets through Commitment Vaults.
        </p>
        <div className="mt-[20px]">
          <CopyCommand command="npm i @pm-amm/sdk" />
        </div>
      </section>

      {/* Demo video */}
      <section className="px-[24px] md:px-[48px] pb-[88px] max-w-[1180px] mx-auto w-full">
        <div className="text-caption mb-[12px]">SEE IT IN ACTION</div>
        <h2 className="text-[26px] md:text-[32px] tracking-[-0.02em] text-text-hi leading-[1.1] mb-[24px]">
          Watch a bet go from a post to a payout.
        </h2>
        <div className="relative w-full max-w-[900px] aspect-video rounded-xl overflow-hidden border border-line bg-surface">
          <iframe
            className="absolute inset-0 w-full h-full"
            src="https://www.youtube.com/embed/yntkycwceWs?si=3QUOZ4QIthxbD8Oi"
            title="Oracle Markets demo"
            loading="lazy"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          />
        </div>
      </section>

      {/* Footer */}
      <footer className="mt-auto border-t border-line px-[24px] md:px-[48px] py-[24px]">
        <div className="max-w-[1180px] mx-auto w-full flex flex-wrap items-center justify-between gap-[12px] font-mono text-[11px] text-muted tracking-[0.03em]">
          <span>
            {BRAND.name} · {ENGINE.credit} ·{" "}
            <a
              href={ENGINE.upstreamRepoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-text-hi"
            >
              upstream (MIT)
            </a>
          </span>
          <div className="flex items-center gap-[18px]">
            <Link href="/markets" className="hover:text-text-hi transition-all duration-[120ms]">
              Markets
            </Link>
            <Link href="/wallet" className="hover:text-text-hi transition-all duration-[120ms]">
              X wallet
            </Link>
            <Link
              href="/leaderboard"
              className="hover:text-text-hi transition-all duration-[120ms]"
            >
              Leaderboard
            </Link>
            <Link href="/docs" className="hover:text-text-hi transition-all duration-[120ms]">
              Docs
            </Link>
            <a
              href={ENGINE.upstreamRepoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-text-hi transition-all duration-[120ms]"
            >
              GitHub
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Pillar(props: { tag: string; title: string; body: string; href?: string }) {
  return (
    <div className="bg-bg p-[24px] md:p-[28px] flex flex-col gap-[10px]">
      <div className="font-mono text-[10px] tracking-[0.1em] uppercase text-accent">
        {props.tag}
      </div>
      <div className="text-[19px] tracking-[-0.01em] text-text-hi">{props.title}</div>
      <p className="text-[13px] leading-[1.6] text-text-dim">{props.body}</p>
      {props.href && (
        <Link
          href={props.href}
          className="mt-auto font-mono text-[12px] text-accent hover:brightness-110"
        >
          Open →
        </Link>
      )}
    </div>
  );
}
