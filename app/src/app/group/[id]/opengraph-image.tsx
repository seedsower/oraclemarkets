import { ImageResponse } from "next/og";
import { getArtDataUri } from "@/lib/server/art";
import type { GroupView, MarketView } from "@pm-amm/sdk";
import { NotFoundCard, OG, OG_SIZE, OgFrame, Question } from "@/lib/server/og";
import { getGroupById, parseId } from "@/lib/server/snapshots";
import { cents, closesIn, legLabel } from "@/lib/share";

export const alt = "Oracle Markets — live outcome odds";
export const size = OG_SIZE;
export const contentType = "image/png";
export const revalidate = 60;

const MAX_LEGS = 4;

function LegRow({ leg, top }: { leg: MarketView; top: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "8px 22px",
        backgroundColor: top ? OG.surface : "transparent",
        border: `1px solid ${top ? OG.line : "transparent"}`,
      }}
    >
      <span style={{ display: "flex", fontSize: 30, color: OG.text, maxWidth: 820 }}>
        {legLabel(leg.name)}
      </span>
      <span style={{ fontSize: 40, color: top ? OG.yes : OG.dim }}>{cents(leg.price)}</span>
    </div>
  );
}

function status(g: GroupView): string {
  if (g.resolved) {
    const w = g.winningLeg === null ? null : g.legs[g.winningLeg];
    return w ? `Resolved: ${legLabel(w.name)}` : "Resolved";
  }
  return `${g.legCount} outcomes · ${closesIn(g.endTs)}`;
}

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const groupId = parseId(id);
  const g = groupId === null ? null : await getGroupById(groupId);
  if (!g) return new ImageResponse(<NotFoundCard what="Market" />, size);

  const art = await getArtDataUri(g.publicKey);
  const legs = g.legs
    .filter((l): l is MarketView => l !== null)
    .sort((a, b) => b.price - a.price)
    .slice(0, MAX_LEGS);
  return new ImageResponse(
    <OgFrame art={art} footer={<span>{status(g)}</span>}>
      <Question text={g.name} compact />
      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: "auto" }}>
        {legs.map((leg, i) => (
          <LegRow key={leg.publicKey} leg={leg} top={i === 0} />
        ))}
      </div>
    </OgFrame>,
    size,
  );
}
