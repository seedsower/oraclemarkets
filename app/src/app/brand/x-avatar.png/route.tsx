import { ImageResponse } from "next/og";
import { OG } from "@/lib/server/og";
import { Mark } from "@/lib/server/brand-art";

/** X profile picture, 400×400 — the mark centred, safe inside X's circular crop. */
export function GET() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: OG.bg,
      }}
    >
      <Mark size={190} />
    </div>,
    { width: 400, height: 400, headers: { "Cache-Control": "public, max-age=86400" } },
  );
}
