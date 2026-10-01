import { ImageResponse } from "next/og";
import { poolValue } from "@pm-amm/sdk/math";
import type { MarketView } from "@pm-amm/sdk";
import { NotFoundCard, OG, OG_SIZE, OgFrame, Question } from "@/lib/server/og";
import { getMarketById, parseId, priceChange24h } from "@/lib/server/snapshots";
import { cents, closesIn, resolvedLabel } from "@/lib/share";
import { findToken } from "@/lib/tokens";

export const alt = "Oracle Markets — live market odds";
export const size = OG_SIZE;
export const contentType = "image/png";
export const revalidate = 60;

function liquidityLabel(m: MarketView): string {
  const tok = findToken(m.collateralMint);
  const raw = m.lEff > 0 && !m.resolved ? poolValue(m.price, m.lEff) : 0;
  const value = raw / 10 ** (tok?.decimals ?? 6);
  const n = value.toLocaleString("en-US", { maximumFractionDigits: value >= 100 ? 0 : 2 });
  return `${n} ${tok?.symbol ?? "tokens"} liquidity`;
}

function Change({ delta }: { delta: number | null }) {
  if (delta === null || Math.abs(delta) < 0.005) return null;
  const up = delta > 0;
  return (
    <span style={{ color: up ? OG.yes : OG.no, fontSize: 30 }}>
      {up ? "▲" : "▼"} {Math.round(Math.abs(delta) * 100)}¢ 24h
    </span>
  );
}

function Prices({ m, delta }: { m: MarketView; delta: number | null }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 48, marginTop: "auto" }}>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <span style={{ color: OG.yes, fontSize: 26, letterSpacing: "0.1em" }}>YES</span>
        <span style={{ color: OG.yes, fontSize: 132, lineHeight: 1, letterSpacing: "-0.04em" }}>
          {cents(m.price)}
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", paddingBottom: 12 }}>
        <span style={{ color: OG.no, fontSize: 22, letterSpacing: "0.1em" }}>NO</span>
        <span style={{ color: OG.no, fontSize: 64, lineHeight: 1 }}>{cents(1 - m.price)}</span>
      </div>
      <div style={{ display: "flex", paddingBottom: 20 }}>
        <Change delta={delta} />
      </div>
    </div>
  );
}

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const marketId = parseId(id);
  const m = marketId === null ? null : await getMarketById(marketId);
  if (!m) return new ImageResponse(<NotFoundCard what="Market" />, size);

  const delta = m.resolved ? null : await priceChange24h(m);
  const status = m.resolved ? resolvedLabel(m.winningSide) : closesIn(m.endTs);
  return new ImageResponse(
    <OgFrame
      footer={
        <span>
          {status} · {liquidityLabel(m)}
        </span>
      }
    >
      <Question text={m.name} />
      {m.resolved ? (
        <div
          style={{
            display: "flex",
            marginTop: "auto",
            fontSize: 96,
            color: m.winningSide === 1 ? OG.yes : OG.no,
          }}
        >
          {resolvedLabel(m.winningSide)}
        </div>
      ) : (
        <Prices m={m} delta={delta} />
      )}
    </OgFrame>,
    size,
  );
}
