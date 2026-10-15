"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { solscanAccountUrl } from "@/lib/constants";
import { marketPath } from "@/lib/share";
import { betPath } from "@/lib/bets";
import { useXHoldings, useXSession, useXStakes } from "./use-xwallet";
import { ExportKey } from "./export-key";

const bot = BRAND.xAt;
const ERRORS: Record<string, string> = {
  denied: "Sign-in was cancelled on X.",
  expired: "That sign-in link expired. Try again.",
  login: "X sign-in didn't work just now. Try again in a minute.",
};

const card = "rounded-xl border border-line bg-surface/40 p-[16px] flex flex-col gap-[10px]";

function Commands() {
  const rows: [string, string][] = [
    ["buy YES $5", "under a market post: buy (or NO)"],
    ["sell YES", "sell all (or sell YES $3)"],
    ["stake YES $10", "in a bet? thread"],
    ["balance", "cash + positions"],
    ["withdraw $20 to <address>", "send USDC out"],
    ["resolve YES", "after a bet's deadline: call the result (or dispute)"],
  ];
  return (
    <section className={card}>
      <span className="text-caption">Trade by replying on X</span>
      <ul className="flex flex-col gap-[6px] text-[13px]">
        {rows.map(([cmd, what]) => (
          <li key={cmd} className="flex flex-wrap gap-x-[10px]">
            <code className="font-mono text-accent">
              {bot} {cmd}
            </code>
            <span className="text-muted">{what}</span>
          </li>
        ))}
      </ul>
      <p className="text-[12px] text-muted">
        Devnet test USDC only. Max $25 per trade and $100 a day. Winnings are paid to this wallet
        automatically when a market resolves.
      </p>
    </section>
  );
}

function SignIn() {
  return (
    <section className={card}>
      <h1 className="text-title">Trade without leaving X</h1>
      <p className="text-[14px] text-text-dim">
        Reply <code className="font-mono text-accent">{bot} buy YES $5</code> under any market post.
        Your first command creates a wallet tied to your X account with $50 of test USDC. Sign in
        here to see it, or export its key to Phantom.
      </p>
      <a
        href="/api/auth/x/login"
        className="self-start px-[16px] py-[9px] rounded-lg bg-accent text-bg font-mono text-[13px] font-medium hover:brightness-110"
      >
        Sign in with X
      </a>
    </section>
  );
}

const TONE = { yes: "text-yes", no: "text-no", muted: "text-muted", accent: "text-accent" };
const row = "flex justify-between gap-[12px] text-[13px]";
const usd = (n: number) => `$${n.toFixed(2)}`;

/** Bet stakes (from X or the site) with where each one stands. */
function Stakes({ wallet }: { wallet: string }) {
  const { data: stakes } = useXStakes(wallet);
  if (!stakes?.length) return null;
  return (
    <>
      <span className="text-caption mt-[6px]">Bets</span>
      <ul className="flex flex-col gap-[8px]">
        {stakes.map((s) => (
          <li key={s.bet.publicKey} className="flex flex-col gap-[2px]">
            <div className={row}>
              <Link href={betPath(s.bet.vaultId)} className="text-text hover:text-text-hi truncate">
                {s.bet.name}
              </Link>
              <span className="font-mono shrink-0">
                {s.yes > 0 && <span className="text-yes">{usd(s.yes / 1e6)} YES</span>}
                {s.yes > 0 && s.no > 0 && " · "}
                {s.no > 0 && <span className="text-no">{usd(s.no / 1e6)} NO</span>}
              </span>
            </div>
            <span className={`font-mono text-[11px] ${TONE[s.tone]}`}>{s.status}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

/** Balance, then open shares, then bet stakes. */
function Holdings({ wallet }: { wallet: string }) {
  const { data, isLoading } = useXHoldings(wallet);
  const { data: stakes } = useXStakes(wallet);
  if (isLoading || !data)
    return <p className="font-mono text-[12px] text-muted">Loading balances…</p>;
  const empty = data.holdings.length === 0 && !stakes?.length;
  return (
    <section className={card}>
      <div className="flex items-baseline justify-between">
        <span className="text-caption">Balance</span>
        <span className="text-[28px] text-text-hi tracking-[-0.02em]">
          ${data.usdc.toFixed(2)} <span className="text-[12px] text-muted font-mono">USDC</span>
        </span>
      </div>
      {empty && <p className="text-[12px] text-muted">No open positions.</p>}
      {data.holdings.length > 0 && (
        <>
          <span className="text-caption mt-[6px]">Positions</span>
          <ul className="flex flex-col gap-[8px]">
            {data.holdings.map((h) => (
              <li key={`${h.market.publicKey}-${h.side}`} className={row}>
                <Link
                  href={marketPath(h.market.marketId)}
                  className="text-text hover:text-text-hi truncate"
                >
                  {h.market.name}
                </Link>
                <span className={`font-mono shrink-0 ${h.side === "YES" ? "text-yes" : "text-no"}`}>
                  {h.amount.toFixed(1)} {h.side} · {usd(h.value)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      <Stakes wallet={wallet} />
    </section>
  );
}

export function XWalletView() {
  const { data: s, isLoading } = useXSession();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setError(new URLSearchParams(window.location.search).get("error")), []);
  if (isLoading || !s) return <p className="font-mono text-[12px] text-muted">Loading…</p>;
  return (
    <>
      {error && <p className="font-mono text-[12px] text-no">{ERRORS[error] ?? ERRORS.login}</p>}
      {!s.signedIn ? (
        <SignIn />
      ) : (
        <>
          <header className="flex items-center justify-between gap-[12px]">
            <h1 className="text-title">@{s.handle}</h1>
            <form action="/api/auth/x/logout" method="post">
              <button className="font-mono text-[11px] text-muted hover:text-text-hi cursor-pointer">
                Sign out
              </button>
            </form>
          </header>
          {s.wallet ? (
            <>
              <a
                href={solscanAccountUrl(s.wallet)}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-[12px] text-muted hover:text-text-hi break-all"
              >
                Wallet {s.wallet} ↗
              </a>
              <Holdings wallet={s.wallet} />
              <ExportKey signedInAt={s.signedInAt ?? 0} />
            </>
          ) : (
            <p className={`${card} text-[14px] text-text-dim`}>
              No wallet yet. Reply <code className="font-mono text-accent">{bot} balance</code> (or
              buy something) on X and the bot will make one with $50 of test USDC.
            </p>
          )}
        </>
      )}
      <Commands />
    </>
  );
}
