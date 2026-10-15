"use client";

import { useQuery } from "@tanstack/react-query";
import { BRAND } from "@/lib/brand";
import { solscanAccountUrl } from "@/lib/constants";

/** Same shape the X bot writes (workers/xbot/src/leaderboard.ts). */
interface LeaderRow {
  wallet: string;
  /** X handle for X-wallet traders; null for site wallets. */
  handle: string | null;
  pnl: number;
  volume: number;
  trades: number;
}

/** @handle (links to X) or a short wallet address (links to Solscan). */
function Trader({ r }: { r: LeaderRow }) {
  const href = r.handle ? `https://x.com/${r.handle}` : solscanAccountUrl(r.wallet);
  const label = r.handle ? `@${r.handle}` : `${r.wallet.slice(0, 4)}…${r.wallet.slice(-4)}`;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`hover:text-accent ${r.handle ? "text-text-hi" : "font-mono text-[13px] text-text"}`}
    >
      {label}
    </a>
  );
}

const usd = (n: number) => `$${Math.abs(n).toFixed(2)}`;
const signed = (n: number) => `${n >= 0 ? "+" : "−"}${usd(n)}`;
const MEDALS = ["🥇", "🥈", "🥉"];

function Row({ r, rank }: { r: LeaderRow; rank: number }) {
  return (
    <tr className="border-t border-line">
      <td className="py-[10px] pr-[8px] font-mono text-[12px] text-muted w-[40px]">
        {MEDALS[rank - 1] ?? rank}
      </td>
      <td className="py-[10px] pr-[8px]">
        <Trader r={r} />
      </td>
      <td
        className={`py-[10px] pr-[8px] font-mono text-right ${r.pnl >= 0 ? "text-yes" : "text-no"}`}
      >
        {signed(r.pnl)}
      </td>
      <td className="py-[10px] pr-[8px] font-mono text-right text-muted hidden sm:table-cell">
        {r.trades}
      </td>
      <td className="py-[10px] font-mono text-right text-muted hidden md:table-cell">
        {usd(r.volume)}
      </td>
    </tr>
  );
}

export function Leaderboard() {
  const { data, isLoading } = useQuery({
    queryKey: ["leaderboard"],
    queryFn: async (): Promise<{ updatedAt: number | null; rows: LeaderRow[] }> =>
      (await fetch("/api/leaderboard")).json(),
    refetchInterval: 60_000,
  });
  const bot = BRAND.xAt;
  return (
    <>
      <header className="flex flex-col gap-[6px]">
        <h1 className="text-title">
          Leaderboard <span className="text-muted text-[14px] font-mono">· last 48 hours</span>
        </h1>
        <p className="text-[13px] text-text-dim">
          Traders on X, ranked by profit: what their wallet is worth now (cash, shares at
          today&apos;s price, open stakes) plus withdrawals, minus the $50 they started with. Join
          by replying <code className="font-mono text-accent">{bot} buy YES $5</code> under any
          market.
        </p>
      </header>
      {isLoading ? (
        <p className="font-mono text-[12px] text-muted">Loading…</p>
      ) : !data?.rows.length ? (
        <p className="font-mono text-[12px] text-muted">
          No trades in the last 48 hours yet. Be the first.
        </p>
      ) : (
        <div className="rounded-xl border border-line bg-surface/40 px-[16px] py-[6px]">
          <table className="w-full text-[14px]">
            <thead>
              <tr className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted text-left">
                <th className="py-[8px] font-normal">#</th>
                <th className="py-[8px] font-normal">Trader</th>
                <th className="py-[8px] pr-[8px] font-normal text-right">Profit</th>
                <th className="py-[8px] pr-[8px] font-normal text-right hidden sm:table-cell">
                  Trades
                </th>
                <th className="py-[8px] font-normal text-right hidden md:table-cell">Volume</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r, i) => (
                <Row key={r.wallet} r={r} rank={i + 1} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data?.updatedAt && (
        <p className="font-mono text-[11px] text-muted">
          Updated {new Date(data.updatedAt).toLocaleTimeString()} · refreshes every 10 minutes ·
          devnet test USDC
        </p>
      )}
    </>
  );
}
