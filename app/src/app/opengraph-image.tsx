import { ImageResponse } from "next/og";
import { BRAND, ENGINE } from "@/lib/brand";
import { OG, OG_SIZE, OgFrame } from "@/lib/server/og";
import { MiniCard } from "@/lib/server/brand-art";

export const alt = `${BRAND.name} — predict the news without leaving X`;
export const size = OG_SIZE;
export const contentType = "image/png";

/** Site-wide share card (pages without their own, e.g. the landing page). */
export default function OgImage() {
  return new ImageResponse(
    <OgFrame footer={<span style={{ fontSize: 20 }}>{ENGINE.credit}</span>}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexGrow: 1,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            fontSize: 70,
            lineHeight: 1.04,
            letterSpacing: "-0.03em",
          }}
        >
          <span style={{ color: OG.text }}>Every argument on X</span>
          <span style={{ color: OG.accent }}>is now a market.</span>
          <span style={{ marginTop: 22, fontSize: 26, color: OG.dim, letterSpacing: 0 }}>
            Reply &quot;bet?&quot; and the bot does the rest.
          </span>
        </div>
        <MiniCard q="Will the Fed cut rates in December?" yes={47} width={400} />
      </div>
    </OgFrame>,
    size,
  );
}
