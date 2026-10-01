import type { ReactNode } from "react";
import { cents } from "@/lib/share";
import type { ShowcaseMarket } from "@/components/landing/x-post-mock";

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="h-[170px] rounded-[12px] border border-line bg-bg p-[14px] flex flex-col justify-center gap-[8px] overflow-hidden">
      {children}
    </div>
  );
}

function Line({ w, tone = "bg-line-2" }: { w: string; tone?: string }) {
  return <span className={`block h-[7px] rounded-full ${tone}`} style={{ width: w }} />;
}

/** 1 — a market link in the timeline, unfurled as a card. */
function SpotIt({ m }: { m: ShowcaseMarket }) {
  return (
    <Frame>
      <div className="flex items-center gap-[8px]">
        <span className="w-[18px] h-[18px] rounded-full bg-surface-2 border border-line-2" />
        <Line w="42%" />
      </div>
      <div className="rounded-[9px] border border-line-2 p-[10px] flex flex-col gap-[6px]">
        <span className="text-[11px] leading-[1.3] text-text-hi line-clamp-2">{m.name}</span>
        <span className="font-mono text-[18px] text-yes leading-none">
          {cents(m.price)} <span className="text-[11px] text-no">NO {cents(1 - m.price)}</span>
        </span>
      </div>
      <Line w="64%" />
    </Frame>
  );
}

/** 2 — the Blink buttons, one being pressed. */
function TapIt() {
  const b = "flex-1 text-center py-[7px] rounded-[8px] font-mono text-[11px]";
  return (
    <Frame>
      <div className="flex gap-[6px]">
        <span className={`${b} bg-yes text-bg ring-2 ring-accent ring-offset-2 ring-offset-bg`}>
          YES $5
        </span>
        <span className={`${b} bg-yes-soft text-yes`}>YES $25</span>
      </div>
      <div className="flex gap-[6px]">
        <span className={`${b} bg-no-soft text-no`}>NO $5</span>
        <span className={`${b} bg-no-soft text-no`}>NO $25</span>
      </div>
      <div className="flex gap-[6px]">
        <span className="flex-1 rounded-[8px] border border-line-2 px-[8px] py-[6px] font-mono text-[10px] text-muted">
          Custom amount
        </span>
        <span className={`${b} flex-none px-[10px] bg-text-hi text-bg`}>Buy</span>
      </div>
    </Frame>
  );
}

/** 3 — the user's own wallet asks for approval. */
function ApproveIt({ m }: { m: ShowcaseMarket }) {
  return (
    <Frame>
      <div className="mx-auto w-[85%] rounded-[12px] border border-line-2 bg-surface p-[12px] flex flex-col gap-[8px]">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] tracking-[0.08em] text-muted">YOUR WALLET</span>
          <span className="w-[8px] h-[8px] rounded-full bg-yes" />
        </div>
        <span className="text-[12px] leading-[1.35] text-text-hi">
          Buying ~9.6 YES at ≈{cents(m.price)}. 2% fee included.
        </span>
        <div className="flex gap-[6px]">
          <span className="flex-1 text-center py-[6px] rounded-[8px] border border-line-2 font-mono text-[10px] text-muted">
            Cancel
          </span>
          <span className="flex-1 text-center py-[6px] rounded-[8px] bg-accent text-bg font-mono text-[10px] font-medium">
            Approve
          </span>
        </div>
      </div>
    </Frame>
  );
}

/** 4 — the prefilled share post. */
function ShareIt({ m }: { m: ShowcaseMarket }) {
  return (
    <Frame>
      <div className="rounded-[10px] border border-line-2 p-[10px] flex flex-col gap-[8px]">
        <span className="text-[11.5px] leading-[1.4] text-text">
          I&apos;m buying YES at {cents(m.price)} on:{" "}
          <span className="text-text-hi">
            {m.name.length > 48 ? `${m.name.slice(0, 47)}…` : m.name}
          </span>
        </span>
        <span className="text-[11px] text-accent">oraclemarkets.app/market/…</span>
        <span className="self-end px-[12px] py-[4px] rounded-full bg-text-hi text-bg font-mono text-[10px] font-medium">
          Post
        </span>
      </div>
    </Frame>
  );
}

const STEPS = [
  {
    title: "Spot a market on X",
    body: "Market links unfurl into a live card: the question, YES and NO prices, time left.",
    art: (m: ShowcaseMarket) => <SpotIt m={m} />,
  },
  {
    title: "Tap YES or NO",
    body: "With a Blink-enabled wallet, buy buttons sit right under the post. Pick $5, $25, or any amount.",
    art: () => <TapIt />,
  },
  {
    title: "Approve in your wallet",
    body: "Your wallet shows exactly what you're buying and the fee. You sign; we never hold your funds or keys.",
    art: (m: ShowcaseMarket) => <ApproveIt m={m} />,
  },
  {
    title: "Share your call",
    body: "Post your side and price in one click. Your wallet address and amount stay private unless you choose to show them.",
    art: (m: ShowcaseMarket) => <ShareIt m={m} />,
  },
];

export function HowItWorks({ market }: { market: ShowcaseMarket }) {
  return (
    <ol className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-[16px]">
      {STEPS.map((s, i) => (
        <li key={s.title} className="flex flex-col gap-[14px]">
          {s.art(market)}
          <div className="flex flex-col gap-[6px]">
            <span className="font-mono text-[10px] tracking-[0.1em] text-accent">0{i + 1}</span>
            <h3 className="text-[17px] tracking-[-0.01em] text-text-hi">{s.title}</h3>
            <p className="text-[13px] leading-[1.6] text-text-dim">{s.body}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
