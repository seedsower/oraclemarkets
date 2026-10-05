import Link from "next/link";
import { LandingNav } from "@/components/layout/landing-nav";
import { CopyCommand } from "@/components/ui/copy-command";
import { BRAND, ENGINE } from "@/lib/brand";
import { CLUSTER } from "@/lib/constants";
import { HowItWorks } from "@/components/landing/how-it-works";
import { EXAMPLE_MARKET, XPostMock, type ShowcaseMarket } from "@/components/landing/x-post-mock";
import { getShowcaseMarket } from "@/lib/server/snapshots";

const CLUSTER_LABEL =
  CLUSTER === "mainnet-beta" ? "Mainnet" : CLUSTER === "devnet" ? "Devnet" : "Localnet";

// The showcase card reads the keeper's Redis cache (never the RPC); refresh it
// at most once a minute.
export const revalidate = 60;

/**
 * Marketing landing: "predict from X". No wallet and no chain reads — the
 * showcase market comes from the keeper cache, with a static example fallback.
 */
export default async function Home() {
  const live = await getShowcaseMarket();
  const showcase: ShowcaseMarket = live ?? EXAMPLE_MARKET;
  return (
    <div className="min-h-screen flex flex-col bg-bg">
      <LandingNav />

      {/* Hero — predict from X */}
      <section className="px-[24px] md:px-[48px] pt-[64px] md:pt-[96px] pb-[72px] max-w-[1180px] mx-auto w-full grid grid-cols-1 lg:grid-cols-[1.05fr_0.95fr] gap-[48px] items-center">
        <div>
          <div className="inline-flex items-center gap-[8px] font-mono text-[10px] tracking-[0.12em] uppercase text-muted border border-line rounded-full px-[12px] py-[5px] mb-[28px]">
            <span className="w-[6px] h-[6px] rounded-full bg-yes" />
            {BRAND.name} on 𝕏 · Solana · {CLUSTER_LABEL}
          </div>
          <h1 className="text-[40px] md:text-[60px] leading-[1.02] tracking-[-0.03em] text-text-hi font-medium max-w-[16ch]">
            Predict the news <span className="text-accent">without leaving X.</span>
          </h1>
          <p className="mt-[24px] text-[15px] md:text-[17px] leading-[1.6] text-text-dim max-w-[52ch]">
            Every {BRAND.name} link turns into a live market card on X: the odds, the deadline, and
            YES / NO buttons right in your timeline. Tap, approve in your own wallet, done. Prices
            move with every trade.
          </p>
          <div className="mt-[36px] flex flex-wrap items-center gap-[12px]">
            <Link
              href="/markets"
              className="px-[18px] py-[11px] bg-accent text-bg rounded-md font-mono text-[13px] tracking-[0.03em] font-medium hover:opacity-90 transition-all duration-[120ms]"
            >
              Browse markets →
            </Link>
            <a
              href="#how-it-works"
              className="px-[18px] py-[11px] border border-line-2 text-text-hi rounded-md font-mono text-[13px] tracking-[0.03em] hover:bg-surface transition-all duration-[120ms]"
            >
              How it works
            </a>
            {BRAND.xHandle && (
              <a
                href={`https://x.com/${BRAND.xHandle.replace(/^@/, "")}`}
                target="_blank"
                rel="noopener noreferrer"
                className="px-[14px] py-[11px] text-text-dim hover:text-text-hi font-mono text-[13px] tracking-[0.03em] transition-all duration-[120ms]"
              >
                Follow {BRAND.xHandle} on 𝕏 ↗
              </a>
            )}
          </div>
        </div>
        <div className="flex justify-center lg:justify-end">
          <XPostMock market={showcase} />
        </div>
      </section>

      {/* How it works */}
      <section
        id="how-it-works"
        className="px-[24px] md:px-[48px] pb-[88px] max-w-[1180px] mx-auto w-full scroll-mt-[24px]"
      >
        <div className="text-caption mb-[12px]">HOW IT WORKS</div>
        <h2 className="text-[26px] md:text-[34px] tracking-[-0.02em] text-text-hi leading-[1.1] mb-[36px] max-w-[24ch]">
          From a post to a position in four taps.
        </h2>
        <HowItWorks market={showcase} />
        <div className="mt-[36px] grid grid-cols-1 md:grid-cols-3 gap-[1px] bg-line border border-line rounded-xl overflow-hidden">
          <Pillar
            tag="Desktop"
            title="Buttons in your timeline"
            body="Turn on Solana Actions in Phantom (Settings → Experimental Features), Backpack or Solflare, and market links show YES / NO buttons on X."
          />
          <Pillar
            tag="Mobile"
            title="One tap to the market"
            body="On phones, links show the live card and open the market here, where you can trade with any Solana wallet."
          />
          <Pillar
            tag="Trust"
            title="Your wallet, your call"
            body="Every trade is a transaction you sign yourself. Outcomes are settled by each market's creator, shown on every market page."
          />
        </div>
      </section>

      {/* Under the hood */}
      <section className="px-[24px] md:px-[48px] pb-[24px] max-w-[1180px] mx-auto w-full">
        <div className="text-caption mb-[12px]">UNDER THE HOOD</div>
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

      {/* Three pillars */}
      <section className="px-[24px] md:px-[48px] pb-[72px] max-w-[1180px] mx-auto w-full">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-[1px] bg-line border border-line rounded-xl overflow-hidden">
          <Pillar
            tag="01 — Markets"
            title="Dynamic pm-AMM"
            body="Binary YES/NO markets priced by P = Φ((y−x)/L_eff). Liquidity decays to zero at expiry so LVR is constant per unit time — LPs earn a predictable yield, arbitrageurs keep the price honest."
          />
          <Pillar
            tag="02 — Vaults"
            title="Commitment Vaults"
            body="Anyone opens a vault; the crowd commits USDC; at launch the market is seeded at the commit-implied price. Binary, or multi-outcome categorical markets of 2–8 legs with Σ pᵢ = 1."
          />
          <Pillar
            tag="03 — SDK"
            title="@pm-amm/sdk"
            body="One typed client wraps all 26 instructions: PDA helpers, decoded reads, composable instruction builders, send wrappers, multi-tx flows, and the float-64 pricing math. Framework-agnostic."
          />
        </div>
      </section>

      {/* SDK snippet */}
      <section className="px-[24px] md:px-[48px] pb-[88px] max-w-[1180px] mx-auto w-full">
        <div className="grid grid-cols-1 lg:grid-cols-[0.9fr_1.1fr] gap-[32px] items-center">
          <div>
            <div className="text-caption mb-[12px]">FOR BUILDERS</div>
            <h2 className="text-[26px] md:text-[32px] tracking-[-0.02em] text-text-hi leading-[1.1]">
              Markets &amp; vaults in a few lines.
            </h2>
            <p className="mt-[14px] text-[14px] leading-[1.6] text-text-dim max-w-[48ch]">
              Point the client at any deployment — pass your program id and collateral mint, supply
              a wallet provider to sign. Read the{" "}
              <Link
                href="/docs"
                className="text-accent hover:text-text-hi underline underline-offset-2"
              >
                integration guide
              </Link>{" "}
              to get started.
            </p>
          </div>
          <pre className="bg-surface border border-line rounded-lg p-[20px] overflow-x-auto font-mono text-[12.5px] leading-[1.7] text-text">
            <span className="text-muted">{`// 1. construct a client (read-only or wallet-aware)`}</span>
            {"\n"}
            <span className="text-no">import</span> {`{ PmAmmClient } `}
            <span className="text-no">from</span>{" "}
            <span className="text-yes">{`"@pm-amm/sdk"`}</span>;{"\n\n"}
            <span className="text-no">const</span> client = PmAmmClient.fromProvider(provider,
            PROGRAM_ID, USDC_MINT);
            {"\n\n"}
            <span className="text-muted">{`// 2. read markets, or create one`}</span>
            {"\n"}
            <span className="text-no">const</span> markets = <span className="text-no">await</span>{" "}
            client.fetchAllMarkets();
            {"\n"}
            <span className="text-no">await</span> client.send.createMarket({"{"}
            {"\n"}
            {"  "}name: <span className="text-yes">{`"Will it ship?"`}</span>, durationSecs: 86_400,
            depositUsdc: 100,
            {"\n"}
            {"}"});
          </pre>
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

function Pillar({ tag, title, body }: { tag: string; title: string; body: string }) {
  return (
    <div className="bg-bg p-[24px] md:p-[28px] flex flex-col gap-[10px]">
      <div className="font-mono text-[10px] tracking-[0.1em] uppercase text-muted">{tag}</div>
      <div className="text-[19px] tracking-[-0.01em] text-text-hi">{title}</div>
      <p className="text-[13px] leading-[1.6] text-text-dim">{body}</p>
    </div>
  );
}
