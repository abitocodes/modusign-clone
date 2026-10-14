/**
 * Plain-text line breaking shared by the PDF generators (문서 편집기 텍스트 상자, 서식 작성기).
 * Mirrors the on-screen CSS `white-space: pre-wrap; word-break: keep-all; overflow-wrap: anywhere`:
 * lines break between words; a word wider than the line is broken between characters.
 */

/** Pretendard vertical metrics (hhea, 2048 units per em): ascender 1950, descender -494. */
export const FONT_ASCENT = 1950 / 2048;
export const FONT_DESCENT = 494 / 2048;

/** Baseline offset from the top of a CSS line box of `lineHeight` for a font of `size`. */
export function baselineOffset(size: number, lineHeight: number) {
  const content = (FONT_ASCENT + FONT_DESCENT) * size;
  return (lineHeight - content) / 2 + FONT_ASCENT * size;
}

export type Measure = (s: string) => number;

/** Wraps `text` (may contain "\n") into lines that fit `maxWidth`. */
export function wrapPlainText(text: string, maxWidth: number, measure: Measure): string[] {
  const lines: string[] = [];
  for (const para of text.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n")) {
    lines.push(...wrapParagraph(para, maxWidth, measure));
  }
  return lines;
}

function wrapParagraph(para: string, maxWidth: number, measure: Measure): string[] {
  if (!para) return [""];
  const tokens = para.match(/\s+|\S+/g) ?? [];
  const lines: string[] = [];
  let line = "";
  for (const tok of tokens) {
    if (/^\s+$/.test(tok)) {
      line += tok;
      continue;
    }
    if (measure(line + tok) <= maxWidth) {
      line += tok;
      continue;
    }
    if (line.trim() !== "") {
      lines.push(line.trimEnd());
      line = "";
    }
    if (measure(line + tok) <= maxWidth) {
      line += tok;
      continue;
    }
    for (const ch of Array.from(tok)) {
      if (line !== "" && measure(line + ch) > maxWidth) {
        lines.push(line);
        line = "";
      }
      line += ch;
    }
  }
  lines.push(line.trimEnd());
  return lines;
}

/** "#rrggbb" → [r, g, b] in 0..1 (black for invalid input). */
export function hexToRgb01(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/**
 * OpenType features turned off when embedding Pretendard with pdf-lib: contextual alternates
 * (e.g. `colon.case` before digits) are written with wrong advances and leave visible gaps.
 */
export const PDF_FONT_FEATURES = { calt: false, rclt: false, kern: false, liga: false, clig: false };
