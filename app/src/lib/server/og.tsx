import type { ReactNode } from "react";
import { BRAND } from "@/lib/brand";

/** Shared look for share cards (1200×630) — design tokens as hex (Satori has no CSS vars). */
export const OG_SIZE = { width: 1200, height: 630 };
export const OG = {
  bg: "#1f2739",
  surface: "#283147",
  line: "#525d79",
  muted: "#9aa3bb",
  dim: "#bcc3d4",
  text: "#fbfcff",
  yes: "#3fdc8c",
  no: "#f2705e",
  accent: "#a98bf5",
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

/** The market's illustration, faded into the right side behind the text. */
function OgArt({ src }: { src: string }) {
  return (
    <div
      style={{ position: "absolute", top: 0, right: 0, width: 640, height: 630, display: "flex" }}
    >
      <img
        src={src}
        width={640}
        height={630}
        alt=""
        style={{ objectFit: "cover", opacity: 0.55 }}
      />
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: 640,
          height: 630,
          backgroundImage: `linear-gradient(90deg, ${OG.bg} 0%, rgba(31,39,57,0.55) 45%, rgba(31,39,57,0) 100%)`,
        }}
      />
    </div>
  );
}

/** Card chrome: wordmark top-left, `footer` bottom row, content in between; optional art behind. */
export function OgFrame({
  children,
  footer,
  art = null,
}: {
  children: ReactNode;
  footer: ReactNode;
  art?: string | null;
}) {
  return (
    <div
      style={{
        position: "relative",
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
      {art && <OgArt src={art} />}
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
