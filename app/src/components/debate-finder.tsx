"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWallet } from "@solana/wallet-adapter-react";
import { categoryAdmins, categoryLabel } from "@/lib/categories";
import { FEATURED_AUTHORITIES } from "@/lib/featured-list";

/** Same shape the X bot writes (workers/xbot/src/finder.ts). */
interface Candidate {
  id: string;
  url: string;
  text: string;
  username: string;
  followers: number;
  likes: number;
  replies: number;
  createdAt: string;
  question: string;
  category: string | null;
  reply: string;
}

const HIDDEN_KEY = "oracle:finder:hidden";
const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n));
const ago = (iso: string) => {
  const h = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 3_600_000));
  return h < 1 ? "just now" : h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
};

/** Posts you've replied to or skipped (this browser only). */
function useHidden(): [Set<string>, (id: string) => void] {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      setHidden(new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? "[]") as string[]));
    } catch {
      // storage unavailable: nothing hidden
    }
  }, []);
  const hide = (id: string) =>
    setHidden((prev) => {
      const next = new Set(prev).add(id);
      try {
        localStorage.setItem(HIDDEN_KEY, JSON.stringify([...next].slice(-500)));
      } catch {
        // storage unavailable: hidden for this visit only
      }
      return next;
    });
  return [hidden, hide];
}

function Card({ c, onDone }: { c: Candidate; onDone: () => void }) {
  const intent = `https://x.com/intent/tweet?in_reply_to=${c.id}&text=${encodeURIComponent(c.reply)}`;
  return (
    <div className="border border-line rounded-lg p-[14px] flex flex-col gap-[8px]">
      <div className="flex flex-wrap items-baseline gap-x-[8px] font-mono text-[11px] text-muted">
        <a
          href={`https://x.com/${c.username}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-text-hi hover:text-accent"
        >
          @{c.username}
        </a>
        <span>{k(c.followers)} followers</span>
        <span>
          · {k(c.likes)} likes · {k(c.replies)} replies · {ago(c.createdAt)}
        </span>
        {c.category && <span className="text-accent">{categoryLabel(c.category)}</span>}
      </div>
      <p className="text-[13px] text-text leading-[1.5] line-clamp-4 whitespace-pre-line">
        {c.text}
      </p>
      <p className="text-[12px] text-text-dim">
        Market: <span className="text-text-hi">{c.question}</span>
      </p>
      <div className="flex flex-wrap items-center gap-[10px]">
        <a
          href={intent}
          target="_blank"
          rel="noopener noreferrer"
          onClick={onDone}
          className="px-[12px] py-[6px] rounded-md bg-accent text-bg font-mono text-[12px] font-medium hover:brightness-110"
        >
          Reply on X: {c.reply}
        </a>
        <a
          href={c.url}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-[12px] text-muted hover:text-text-hi"
        >
          Open post ↗
        </a>
        <button
          onClick={onDone}
          className="ml-auto font-mono text-[12px] text-muted hover:text-text-hi cursor-pointer"
        >
          Skip
        </button>
      </div>
    </div>
  );
}

/**
 * Admin-only: fresh arguments on X that would make good bets (found every few
 * hours by the X bot). "Reply on X" opens X's composer as a reply from YOUR
 * account with the bet? already filled in — a person posts it, not the bot.
 */
export function DebateFinder() {
  const { publicKey } = useWallet();
  const [hidden, hide] = useHidden();
  const { data } = useQuery({
    queryKey: ["finder"],
    queryFn: async (): Promise<{ updatedAt: number | null; items: Candidate[] }> =>
      (await fetch("/api/finder")).json(),
    refetchInterval: 5 * 60_000,
  });
  if (!publicKey || !categoryAdmins(FEATURED_AUTHORITIES).has(publicKey.toBase58())) return null;
  const items = (data?.items ?? []).filter((c) => !hidden.has(c.id));
  return (
    <section>
      <div className="text-caption mt-[32px] mb-[8px]">DEBATE FINDER</div>
      <p className="text-[11px] text-muted font-mono mb-[12px]">
        Arguments on X that would make good bets, refreshed every few hours. &quot;Reply on X&quot;
        opens a reply from your own account with the bet already written. Post it, and the bot opens
        the market. Replied or skipped posts are hidden in this browser.
      </p>
      {!items.length ? (
        <p className="text-[12px] text-muted font-mono">
          Nothing new right now. Check back in a few hours.
        </p>
      ) : (
        <div className="space-y-[10px]">
          {items.slice(0, 30).map((c) => (
            <Card key={c.id} c={c} onDone={() => hide(c.id)} />
          ))}
        </div>
      )}
    </section>
  );
}
