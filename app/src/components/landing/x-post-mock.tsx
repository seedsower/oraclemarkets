import { cents, closesIn } from "@/lib/share";
import { BRAND } from "@/lib/brand";

/** Data the mock needs — a live market, or the static example. */
export interface ShowcaseMarket {
  name: string;
  price: number;
  endTs: number;
  marketId?: number;
}

export const EXAMPLE_MARKET: ShowcaseMarket = {
  name: "Will SOL close above $200 on Oct 4, 2026?",
  price: 0.52,
  endTs: Math.floor(Date.now() / 1000) + 3 * 86_400,
};

function Avatar() {
  return (
    <div className="w-[40px] h-[40px] rounded-full bg-surface-2 border border-line-2 flex items-center justify-center shrink-0">
      <span className="w-[14px] h-[14px] rounded-full border-[2.5px] border-accent" />
    </div>
  );
}

/** The share card, as X renders it from our og:image. */
function LinkCard({ m }: { m: ShowcaseMarket }) {
  return (
    <div className="border border-line-2 rounded-[14px] overflow-hidden bg-bg">
      <div className="px-[18px] pt-[16px] pb-[18px] flex flex-col gap-[14px]">
        <div className="font-mono text-[10px] tracking-[0.08em] text-muted">ORACLE/MARKETS</div>
        <div className="text-[17px] leading-[1.25] text-text-hi tracking-[-0.01em]">{m.name}</div>
        <div className="flex items-end gap-[18px]">
          <div className="flex flex-col">
            <span className="font-mono text-[10px] text-yes tracking-[0.1em]">YES</span>
            <span className="text-[40px] leading-none text-yes tracking-[-0.03em]">
              {cents(m.price)}
            </span>
          </div>
          <div className="flex flex-col pb-[3px]">
            <span className="font-mono text-[10px] text-no tracking-[0.1em]">NO</span>
            <span className="text-[22px] leading-none text-no">{cents(1 - m.price)}</span>
          </div>
          <span className="ml-auto whitespace-nowrap font-mono text-[11px] text-muted pb-[4px]">
            {closesIn(m.endTs)}
          </span>
        </div>
      </div>
      <BlinkButtons />
    </div>
  );
}

/** The Blink layer wallets add under the card. */
function BlinkButtons() {
  const btn = "flex-1 text-center py-[8px] rounded-[9px] font-mono text-[12px] font-medium";
  return (
    <div className="border-t border-line px-[14px] py-[12px] flex flex-col gap-[8px] bg-surface">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-[8px]">
        <span
          className={`${btn} bg-yes text-bg ring-2 ring-accent ring-offset-2 ring-offset-surface`}
        >
          YES $5
        </span>
        <span className={`${btn} bg-yes-soft text-yes`}>YES $25</span>
        <span className={`${btn} bg-no-soft text-no`}>NO $5</span>
        <span className={`${btn} bg-no-soft text-no`}>NO $25</span>
      </div>
      <div className="flex gap-[8px]">
        <span className="flex-1 px-[12px] py-[8px] rounded-[9px] border border-line-2 font-mono text-[12px] text-muted">
          USDC on YES (1–250)
        </span>
        <span className={`${btn} flex-none px-[16px] bg-text-hi text-bg`}>Buy YES</span>
      </div>
      <div className="font-mono text-[10px] text-muted text-center">
        Signed in your wallet · non-custodial
      </div>
    </div>
  );
}

/** A post from the brand account with a market link that unfurls as a Blink. */
export function XPostMock({ market }: { market: ShowcaseMarket }) {
  const handle = BRAND.xHandle ?? "@OracleMarkets";
  return (
    <figure
      aria-label="Illustration: a market link on X unfurls into YES and NO buttons"
      className="w-full max-w-[460px] rounded-[18px] border border-line bg-surface/60 p-[12px] sm:p-[18px] shadow-[0_30px_80px_-30px_rgba(0,0,0,0.6)]"
    >
      <div className="flex gap-[12px]">
        <Avatar />
        <div className="min-w-0 flex-1 flex flex-col gap-[10px]">
          <div className="flex items-center gap-[6px] text-[14px] min-w-0">
            <span className="text-text-hi font-medium whitespace-nowrap">{BRAND.name}</span>
            <span className="text-muted truncate hidden sm:inline">{handle} · 2m</span>
            <span className="ml-auto text-muted font-mono text-[13px]">𝕏</span>
          </div>
          <p className="text-[14px] leading-[1.5] text-text">
            New market just opened. Where do you stand?{" "}
            <span className="text-accent">oraclemarkets.app/market/…</span>
          </p>
          <LinkCard m={market} />
        </div>
      </div>
    </figure>
  );
}
