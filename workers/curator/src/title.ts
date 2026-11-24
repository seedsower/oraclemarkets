/**
 * On-chain market names are a fixed 64-byte UTF-8 field (`Market::name`,
 * zero-padded). A title is used only if it fits whole; nothing is ever cut,
 * so a multibyte character can't be split.
 */
export const NAME_MAX_BYTES = 64;

export const utf8Bytes = (s: string): number => Buffer.byteLength(s, "utf8");

/** Whitespace collapsed, trimmed; NUL removed (it would read as padding). */
export const cleanTitle = (s: string): string =>
  s
    .replace(/\u0000/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** The partner shortens some display titles itself ("…Oyo State…"): not a usable name. */
export const isTruncated = (s: string): boolean => /(…|\.\.\.)$/.test(cleanTitle(s));

export function fitsName(s: string, max = NAME_MAX_BYTES): boolean {
  const t = cleanTitle(s);
  return t.length > 0 && utf8Bytes(t) <= max && !isTruncated(t);
}

/**
 * The first candidate that fits: a vetted short title (Phase 2 asks Claude for
 * one), then the partner's display title, then the full question text.
 */
export function pickTitle(candidates: (string | undefined)[]): string | null {
  for (const c of candidates) if (c && fitsName(c)) return cleanTitle(c);
  return null;
}
