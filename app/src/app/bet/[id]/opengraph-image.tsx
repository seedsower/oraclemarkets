import { ImageResponse } from "next/og";
import { formatUsdc } from "@pm-amm/sdk/math";
import { NotFoundCard, OG, OG_SIZE, OgFrame, Question } from "@/lib/server/og";
import { getBetById, getBetMeta } from "@/lib/server/bets";
import { parseId } from "@/lib/server/snapshots";

export const alt = "Oracle Markets — a bet from X";
export const size = OG_SIZE;
export const contentType = "image/png";
export const revalidate = 60;

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const vaultId = parseId(id);
  const [v, meta] =
    vaultId === null ? [null, null] : await Promise.all([getBetById(vaultId), getBetMeta(vaultId)]);
  if (!v) return new ImageResponse(<NotFoundCard what="Bet" />, size);
  const yes = Math.round(v.impliedYes * 100);
  return new ImageResponse(
    <OgFrame footer={<span>Pot ${formatUsdc(v.total)} · winner takes the pot</span>}>
      <span style={{ fontSize: 22, color: OG.accent, letterSpacing: "0.12em", marginBottom: 14 }}>
        BET
      </span>
      <Question text={meta?.question ?? v.name} compact />
      <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 54 }}>
          <span style={{ color: OG.yes }}>YES {yes}%</span>
          <span style={{ color: OG.no }}>NO {100 - yes}%</span>
        </div>
        <div style={{ display: "flex", height: 14, borderRadius: 7, backgroundColor: OG.no }}>
          <div style={{ width: `${yes}%`, height: 14, borderRadius: 7, backgroundColor: OG.yes }} />
        </div>
      </div>
    </OgFrame>,
    size,
  );
}
