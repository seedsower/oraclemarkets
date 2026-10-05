/** Oracle Markets wordmark — bracketed [O] glyph + oracle/markets lockup. */
export function Wordmark({
  size = 16,
  tone = "light",
}: {
  size?: number;
  tone?: "light" | "dark";
}) {
  const color = tone === "light" ? "var(--text-hi)" : "var(--bg)";
  const dim = tone === "light" ? "var(--muted)" : "oklch(0.45 0.03 268)";

  return (
    <div
      className="inline-flex items-center"
      aria-label="Oracle Markets"
      style={{
        gap: size * 0.4,
        color,
        fontFamily: "var(--font-sans)",
        fontSize: size,
        fontWeight: 500,
        letterSpacing: "-0.02em",
        lineHeight: 1,
      }}
    >
      <span
        aria-hidden
        className="inline-flex items-center justify-center"
        style={{
          width: size * 0.9,
          height: size * 0.9,
          border: `1px solid ${color}`,
          borderRadius: 2,
          fontSize: size * 0.55,
          fontFamily: "var(--font-mono)",
          fontWeight: 500,
          letterSpacing: 0,
        }}
      >
        <span
          style={{
            width: size * 0.34,
            height: size * 0.34,
            border: `${Math.max(1, size * 0.08)}px solid var(--accent)`,
            borderRadius: "50%",
          }}
        />
      </span>
      <span aria-hidden>
        oracle<span style={{ color: dim }}>/</span>markets
      </span>
    </div>
  );
}
