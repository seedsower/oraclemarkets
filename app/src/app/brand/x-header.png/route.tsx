import { ImageResponse } from "next/og";
import { BRAND } from "@/lib/brand";
import { OG } from "@/lib/server/og";
import { Mark, MiniCard } from "@/lib/server/brand-art";

/**
 * X profile header, 1500×500 — download and upload in X → Edit profile.
 * X overlays the avatar bottom-left and crops edges on some screens, so the
 * copy sits upper-left of centre and the card on the right.
 */
export function GET() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 110px 40px 260px",
        backgroundColor: OG.bg,
        backgroundImage: `radial-gradient(circle at 78% 40%, rgba(224,184,112,0.16), transparent 45%)`,
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <Mark size={52} />
          <div style={{ display: "flex", fontSize: 44, color: OG.text, letterSpacing: "-0.02em" }}>
            oracle<span style={{ color: OG.muted }}>/</span>markets
          </div>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            fontSize: 58,
            lineHeight: 1.05,
            letterSpacing: "-0.03em",
          }}
        >
          <span style={{ color: OG.text }}>Predict the news</span>
          <span style={{ color: OG.accent }}>without leaving X.</span>
        </div>
        <span style={{ fontSize: 24, color: OG.dim }}>{BRAND.tagline} · oraclemarkets.app</span>
      </div>
      <MiniCard q="Will the Fed cut rates in December?" yes={47} width={440} />
    </div>,
    { width: 1500, height: 500, headers: { "Cache-Control": "public, max-age=86400" } },
  );
}
