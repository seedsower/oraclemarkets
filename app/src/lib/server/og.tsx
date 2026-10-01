import type { ReactNode } from "react";
import { BRAND } from "@/lib/brand";

/** Shared look for share cards (1200×630) — design tokens as hex (Satori has no CSS vars). */
export const OG_SIZE = { width: 1200, height: 630 };
export const OG = {
  bg: "#1f1d1a",
  surface: "#272420",
  line: "#47423d",
  muted: "#8a847c",
  dim: "#b5afa6",
  text: "#f5efe3",
  yes: "#7fb08a",
  no: "#d0806a",
  accent: "#e0b870",
};

/** Question size steps down with length so 3 lines always fit. */
export function questionSize(q: string): number {
  if (q.length <= 40) return 60;
  if (q.length <= 80) return 50;
  if (q.length <= 120) return 42;
  return 36;
}

function Wordmark() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 34,
          height: 34,
          border: `2px solid ${OG.text}`,
          borderRadius: 3,
        }}
      >
        <div
          style={{ width: 13, height: 13, borderRadius: 13, border: `3px solid ${OG.accent}` }}
        />
      </div>
      <div style={{ display: "flex", fontSize: 30, color: OG.text, letterSpacing: "-0.02em" }}>
        oracle<span style={{ color: OG.muted }}>/</span>markets
      </div>
    </div>
  );
}

/** Card chrome: wordmark top-left, `footer` bottom row, content in between. */
export function OgFrame({ children, footer }: { children: ReactNode; footer: ReactNode }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "56px 64px",
        backgroundColor: OG.bg,
        fontFamily: "sans-serif",
        color: OG.text,
      }}
    >
      <Wordmark />
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, marginTop: 36 }}>
        {children}
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderTop: `1px solid ${OG.line}`,
          paddingTop: 24,
          fontSize: 24,
          color: OG.dim,
        }}
      >
        {footer}
        <span style={{ color: OG.muted, fontSize: 20 }}>{BRAND.tagline}</span>
      </div>
    </div>
  );
}

/** `compact` = at most ~2 lines, for cards that also list outcomes. */
export function Question({ text, compact = false }: { text: string; compact?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        fontSize: compact ? Math.min(questionSize(text), 42) : questionSize(text),
        lineHeight: 1.15,
        letterSpacing: "-0.02em",
        color: OG.text,
        maxHeight: compact ? 100 : 220,
        overflow: "hidden",
      }}
    >
      {text}
    </div>
  );
}

export function NotFoundCard({ what }: { what: string }) {
  return (
    <OgFrame footer={<span>{BRAND.name}</span>}>
      <Question text={`${what} not found`} />
    </OgFrame>
  );
}
