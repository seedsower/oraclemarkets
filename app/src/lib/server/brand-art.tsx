import { OG } from "@/lib/server/og";

/** The bracketed-O mark at any size (Satori-safe: flex + inline styles only). */
export function Mark({ size }: { size: number }) {
  const ring = Math.round(size * 0.38);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        border: `${Math.max(2, Math.round(size * 0.055))}px solid ${OG.text}`,
        borderRadius: Math.round(size * 0.08),
      }}
    >
      <div
        style={{
          width: ring,
          height: ring,
          borderRadius: ring,
          border: `${Math.max(3, Math.round(size * 0.1))}px solid ${OG.accent}`,
        }}
      />
    </div>
  );
}

/** Miniature market card with YES/NO pills — the product, in one glance. */
export function MiniCard({ q, yes, width }: { q: string; yes: number; width: number }) {
  const pill = (bg: string, color: string, label: string) => (
    <div
      style={{
        display: "flex",
        flex: 1,
        justifyContent: "center",
        padding: "12px 0",
        borderRadius: 12,
        backgroundColor: bg,
        color,
        fontSize: 22,
      }}
    >
      {label}
    </div>
  );
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width,
        padding: 26,
        gap: 18,
        borderRadius: 22,
        border: `2px solid ${OG.line}`,
        backgroundColor: OG.surface,
      }}
    >
      <div style={{ display: "flex", fontSize: 26, color: OG.text, lineHeight: 1.25 }}>{q}</div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 20 }}>
        <span style={{ fontSize: 64, color: OG.yes, lineHeight: 1 }}>{yes}¢</span>
        <span style={{ fontSize: 30, color: OG.no, paddingBottom: 6 }}>NO {100 - yes}¢</span>
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        {pill(OG.yes, OG.bg, "YES $5")}
        {pill("rgba(127,176,138,0.15)", OG.yes, "YES $25")}
        {pill("rgba(208,128,106,0.15)", OG.no, "NO $5")}
      </div>
    </div>
  );
}
