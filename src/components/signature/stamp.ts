/**
 * Red seal (도장) generation.
 *
 * A stamp is described as a list of vector primitives (ellipse / rect / fitted glyph) in a
 * 300×300 box. The same description is rendered two ways:
 *  - as inline SVG for the previews (`<StampSvg>`; inline SVG uses the page's web fonts), and
 *  - onto a canvas for the saved PNG (`stampToPng`). Rasterising through an <img src="data:image/svg+xml">
 *    would lose the web fonts (SVG images cannot load them), so the canvas path draws the very same
 *    primitives with the same transforms.
 * Glyphs are measured with canvas text metrics and stretched into grid cells, the way seal makers
 * fill the face of a stamp.
 */
import { STAMP_FONTS, type FontRef } from "./fonts";
import { createCanvas, ensureFonts, fontCss, measureContext, toPng } from "./render";

export const STAMP_SIZE = 300;
/** seal ink (content colour, theme independent) */
export const STAMP_RED = "#e1251b";

/** affine matrix [a, b, c, d, e, f] — x' = a·x + c·y + e, y' = b·x + d·y + f */
export type Mat = [number, number, number, number, number, number];

export type StampPrim =
  | { t: "ellipse"; cx: number; cy: number; rx: number; ry: number; sw: number }
  | { t: "rect"; x: number; y: number; w: number; h: number; r: number; sw: number }
  | { t: "glyph"; ch: string; font: FontRef; size: number; m: Mat };

export interface StampSpec {
  key: string;
  size: number;
  color: string;
  prims: StampPrim[];
}

export type StampScript = "ko" | "en";

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const MEASURE_PX = 100;

function mul(A: Mat, B: Mat): Mat {
  return [
    A[0] * B[0] + A[2] * B[1],
    A[1] * B[0] + A[3] * B[1],
    A[0] * B[2] + A[2] * B[3],
    A[1] * B[2] + A[3] * B[3],
    A[0] * B[4] + A[2] * B[5] + A[4],
    A[1] * B[4] + A[3] * B[5] + A[5],
  ];
}

interface FitOptions {
  /** "fill" stretches the glyph into the box (bounded by maxStretch), "contain" keeps its aspect ratio */
  mode?: "fill" | "contain";
  /** max ratio between horizontal and vertical scale in fill mode */
  maxStretch?: number;
  /** inner padding of the box, as a fraction of the smaller side */
  pad?: number;
}

/** Fits a glyph (or a short text run) into `box` using its real ink bounds. */
function fitGlyph(text: string, font: FontRef, box: Box, { mode = "fill", maxStretch = 1.6, pad = 0.06 }: FitOptions = {}): StampPrim | null {
  if (!text.trim()) return null;
  const ctx = measureContext();
  ctx.font = fontCss(font, MEASURE_PX);
  const mt = ctx.measureText(text);
  const L = -mt.actualBoundingBoxLeft;
  const R = mt.actualBoundingBoxRight;
  const T = -mt.actualBoundingBoxAscent;
  const B = mt.actualBoundingBoxDescent;
  const gw = Math.max(1, R - L);
  const gh = Math.max(1, B - T);
  const p = Math.min(box.w, box.h) * pad;
  const bw = Math.max(1, box.w - p * 2);
  const bh = Math.max(1, box.h - p * 2);
  let sx = bw / gw;
  let sy = bh / gh;
  if (mode === "contain") {
    sx = sy = Math.min(sx, sy);
  } else {
    if (sx / sy > maxStretch) sx = sy * maxStretch;
    if (sy / sx > maxStretch) sy = sx * maxStretch;
  }
  const ox = box.x + p + (bw - gw * sx) / 2;
  const oy = box.y + p + (bh - gh * sy) / 2;
  return { t: "glyph", ch: text, font, size: MEASURE_PX, m: [sx, 0, 0, sy, ox - L * sx, oy - T * sy] };
}

/** Same as fitGlyph but around the origin, then rotated by `angle` (radians, 0 = up) and moved to (px, py). */
function fitRotated(text: string, font: FontRef, w: number, h: number, angle: number, px: number, py: number, opts?: FitOptions) {
  const g = fitGlyph(text, font, { x: -w / 2, y: -h / 2, w, h }, opts);
  if (!g || g.t !== "glyph") return null;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  g.m = mul([cos, sin, -sin, cos, px, py], g.m);
  return g;
}

/** Splits `count` items over `lines` lines as evenly as possible (earlier lines get the extra ones). */
function distribute(count: number, lines: number) {
  const base = Math.floor(count / lines);
  const extra = count % lines;
  return Array.from({ length: lines }, (_, i) => base + (i < extra ? 1 : 0)).filter((n) => n > 0);
}

/**
 * Cell boxes for `count` characters inside `box`: `lines` rows top→bottom, characters left→right
 * (the reading order of the faces the original service generates, e.g. 주식회사 / 오픈사인).
 */
function gridCells(count: number, box: Box, lines: number): Box[] {
  const per = distribute(count, Math.max(1, Math.min(lines, count)));
  const cells: Box[] = [];
  const rh = box.h / per.length;
  per.forEach((n, r) => {
    const cw = box.w / n;
    for (let i = 0; i < n; i++) cells.push({ x: box.x + i * cw, y: box.y + r * rh, w: cw, h: rh });
  });
  return cells;
}

/**
 * Narrows cells so that their outer corners stay inside an ellipse (minus `inset` for the border),
 * otherwise wide glyphs in the top / bottom rows of a tall ellipse cross its outline.
 */
function clampToEllipse(cells: Box[], cx: number, cy: number, rx: number, ry: number, inset: number): Box[] {
  const ax = rx - inset;
  const ay = ry - inset;
  return cells.map((c) => {
    const dy = Math.max(Math.abs(c.y - cy), Math.abs(c.y + c.h - cy));
    const t = Math.min(1, dy / ay);
    const hw = ax * Math.sqrt(1 - t * t);
    const x0 = Math.max(c.x, cx - hw);
    const x1 = Math.min(c.x + c.w, cx + hw);
    const w = Math.max(c.w * 0.4, x1 - x0);
    if (w >= c.w) return c;
    const mid = x1 > x0 ? (x0 + x1) / 2 : c.x + c.w / 2;
    return { x: mid - w / 2, y: c.y, w, h: c.h };
  });
}

function glyphsInCells(chars: string[], cells: Box[], font: FontRef, opts?: FitOptions) {
  const out: StampPrim[] = [];
  chars.forEach((ch, i) => {
    const cell = cells[i];
    if (!cell) return;
    const g = fitGlyph(ch, font, cell, opts);
    if (g) out.push(g);
  });
  return out;
}

const chars = (s: string) => Array.from(s.replace(/\s+/g, ""));

/** Characters for the square / round grid faces: 홍길동 → 홍길동인, 이산 → 이산지인 … */
function gridText(name: string) {
  const c = chars(name).slice(0, 8);
  if (c.length === 2) return [...c, "지", "인"];
  if (c.length === 3 || c.length === 5 || c.length === 7) return [...c, "인"];
  return c;
}

function gridLines(count: number) {
  if (count <= 1) return 1;
  if (count <= 6) return 2;
  return 3;
}

/** Splits a Latin name into 1–2 balanced lines at a space. */
function latinLines(name: string, oneLineMax = 9) {
  const v = name.trim().replace(/\s+/g, " ").toUpperCase();
  if (v.length <= oneLineMax || !v.includes(" ")) return [v];
  const spaces = [...v.matchAll(/ /g)].map((m) => m.index ?? 0);
  const best = spaces.reduce((a, b) => (Math.abs(b - v.length / 2) < Math.abs(a - v.length / 2) ? b : a));
  return [v.slice(0, best), v.slice(best + 1)];
}

const S = STAMP_SIZE;
const C = S / 2;

/* ------------------------------------------------------------ personal */

function ellipseStacked(key: string, name: string, font: FontRef, look: "seal" | "plain" | "bold"): StampSpec {
  const c = chars(name).slice(0, 8);
  const single = c.length === 1;
  const twoCols = c.length > 4;
  const rx = single ? 104 : twoCols ? 104 : 80;
  const ry = 138;
  const sw = look === "bold" ? 10 : look === "seal" ? 7 : 8;
  const box: Box = single
    ? { x: C - rx * 0.72, y: C - ry * 0.55, w: rx * 1.44, h: ry * 1.1 }
    : { x: C - rx * 0.62, y: C - ry * 0.8, w: rx * 1.24, h: ry * 1.6 };
  // one character per line (홍/길/동); longer names two per line (다섯/글자/이)
  const rows = twoCols ? Math.ceil(c.length / 2) : c.length;
  const cells = clampToEllipse(gridCells(c.length, box, rows), C, C, rx, ry, sw / 2 + 5);
  const opts: FitOptions =
    look === "seal" ? { mode: "fill", maxStretch: 2.2, pad: 0.04 } : look === "bold" ? { mode: "fill", maxStretch: 1.3, pad: 0.05 } : { mode: "contain", pad: 0.07 };
  return { key, size: S, color: STAMP_RED, prims: [{ t: "ellipse", cx: C, cy: C, rx, ry, sw }, ...glyphsInCells(c, cells, font, opts)] };
}

function circleGrid(key: string, name: string, font: FontRef, look: "seal" | "plain" | "bold"): StampSpec {
  const c = gridText(name);
  const r = 140;
  const sw = look === "bold" ? 11 : look === "seal" ? 7 : 8;
  const side = c.length === 1 ? r * 1.25 : r * 1.46;
  const box: Box = { x: C - side / 2, y: C - side / 2, w: side, h: side };
  const cells = gridCells(c.length, box, gridLines(c.length));
  const stretch = c.length === 1 ? 1.15 : 1;
  const opts: FitOptions =
    look === "seal"
      ? { mode: "fill", maxStretch: 1.8 / stretch, pad: 0.03 }
      : look === "bold"
        ? { mode: "fill", maxStretch: 1.25 / stretch, pad: 0.03 }
        : { mode: "contain", pad: 0.06 };
  return { key, size: S, color: STAMP_RED, prims: [{ t: "ellipse", cx: C, cy: C, rx: r, ry: r, sw }, ...glyphsInCells(c, cells, font, opts)] };
}

function squareGrid(key: string, name: string, font: FontRef, look: "seal" | "bold"): StampSpec {
  const c = gridText(name);
  const m = 12;
  const sw = look === "bold" ? 12 : 8;
  const inset = look === "bold" ? 30 : 26;
  const box: Box = { x: inset, y: inset, w: S - inset * 2, h: S - inset * 2 };
  const cells = gridCells(c.length, box, gridLines(c.length));
  const single = c.length === 1;
  const opts: FitOptions =
    look === "seal" ? { mode: "fill", maxStretch: single ? 1.3 : 1.8, pad: single ? 0.08 : 0.02 } : { mode: "fill", maxStretch: single ? 1.15 : 1.3, pad: single ? 0.08 : 0.03 };
  return { key, size: S, color: STAMP_RED, prims: [{ t: "rect", x: m, y: m, w: S - m * 2, h: S - m * 2, r: 6, sw }, ...glyphsInCells(c, cells, font, opts)] };
}

/* Latin names: one or two lines inside a wide ellipse / circle / square */
function latinStamp(key: string, name: string, font: FontRef, shape: "ellipse" | "circle" | "square", bold: boolean): StampSpec {
  // the wide ellipse keeps "KIM MINSU" on one line; circle / square faces stack the words
  const lines = latinLines(name, shape === "ellipse" ? 9 : 5);
  const sw = bold ? 11 : 8;
  const prims: StampPrim[] = [];
  let box: Box;
  if (shape === "ellipse") {
    prims.push({ t: "ellipse", cx: C, cy: C, rx: 140, ry: 92, sw });
    box = { x: C - 104, y: C - (lines.length === 1 ? 36 : 58), w: 208, h: lines.length === 1 ? 72 : 116 };
  } else if (shape === "circle") {
    prims.push({ t: "ellipse", cx: C, cy: C, rx: 140, ry: 140, sw });
    prims.push({ t: "ellipse", cx: C, cy: C, rx: 124, ry: 124, sw: 3 });
    box = { x: C - 96, y: C - (lines.length === 1 ? 44 : 70), w: 192, h: lines.length === 1 ? 88 : 140 };
  } else {
    prims.push({ t: "rect", x: 12, y: 12, w: S - 24, h: S - 24, r: 6, sw });
    box = { x: 36, y: C - (lines.length === 1 ? 52 : 92), w: S - 72, h: lines.length === 1 ? 104 : 184 };
  }
  const lh = box.h / lines.length;
  lines.forEach((line, i) => {
    const g = fitGlyph(line, font, { x: box.x, y: box.y + i * lh, w: box.w, h: lh }, { mode: "fill", maxStretch: bold ? 1.4 : 1.7, pad: 0.06 });
    if (g) prims.push(g);
  });
  return { key, size: S, color: STAMP_RED, prims };
}

/** 8 personal stamp variants for a name (한글: 3 ellipses, 3 circles, 2 squares). */
export async function personalStamps(name: string, script: StampScript): Promise<StampSpec[]> {
  const value = name.trim();
  if (!value) return [];
  const F = STAMP_FONTS;
  await ensureFonts([F.seal, F.serif, F.bold, F.brush], value + "인지");
  if (script === "en") {
    return [
      latinStamp("en-ellipse-seal", value, F.seal, "ellipse", false),
      latinStamp("en-ellipse-serif", value, F.serif, "ellipse", false),
      latinStamp("en-ellipse-bold", value, F.bold, "ellipse", true),
      latinStamp("en-circle-seal", value, F.seal, "circle", false),
      latinStamp("en-circle-brush", value, F.brush, "circle", false),
      latinStamp("en-circle-bold", value, F.bold, "circle", true),
      latinStamp("en-square-serif", value, F.serif, "square", false),
      latinStamp("en-square-bold", value, F.bold, "square", true),
    ];
  }
  return [
    ellipseStacked("ellipse-seal", value, F.seal, "seal"),
    ellipseStacked("ellipse-plain", value, F.serif, "plain"),
    ellipseStacked("ellipse-bold", value, F.bold, "bold"),
    circleGrid("circle-seal", value, F.seal, "seal"),
    circleGrid("circle-plain", value, F.brush, "plain"),
    circleGrid("circle-bold", value, F.bold, "bold"),
    squareGrid("square-seal", value, F.seal, "seal"),
    squareGrid("square-bold", value, F.bold, "bold"),
  ];
}

/* ------------------------------------------------------------ corporate */

/**
 * Rows for a corporate face: about as many rows as characters per row, filled left→right, top→bottom
 * (우리회사대표이사인 → 우리회 / 사대표 / 이사인), like the faces the original service generates.
 */
function squareRows(count: number) {
  return Math.max(1, Math.ceil(count / Math.ceil(Math.sqrt(count))));
}

/** Splits `cs` into consecutive lines with the given lengths. */
function splitLines<T>(cs: T[], lengths: number[]) {
  let i = 0;
  return lengths.map((n) => cs.slice(i, (i += n)));
}

/**
 * Lines of a square corporate face. A company name with several words keeps one word per line
 * (주식회사 / 오픈사인 / 대표이사인); otherwise the characters fill a near-square grid
 * (우리회 / 사대표 / 이사인).
 */
function corporateLines(company: string, title: string): string[][] {
  const tail = [...chars(title).slice(0, 6), "인"];
  const words = company.trim().split(/\s+/).filter(Boolean);
  if (words.length > 1) {
    const lines = words.flatMap((w) => {
      const cs = Array.from(w);
      return splitLines(cs, distribute(cs.length, Math.ceil(cs.length / 5)));
    });
    lines.push(tail);
    if (lines.length <= 4) return lines;
  }
  const all = [...chars(company).slice(0, 16), ...tail];
  return splitLines(all, distribute(all.length, squareRows(all.length)));
}

function corporateSquare(key: string, company: string, title: string, font: FontRef, look: "seal" | "plain" | "bold"): StampSpec {
  const lines = corporateLines(company, title);
  const sw = look === "bold" ? 12 : 9;
  const prims: StampPrim[] = [{ t: "rect", x: 10, y: 10, w: S - 20, h: S - 20, r: 4, sw }];
  if (look !== "bold") prims.push({ t: "rect", x: 24, y: 24, w: S - 48, h: S - 48, r: 2, sw: 3 });
  const inset = look === "bold" ? 28 : 34;
  const box: Box = { x: inset, y: inset, w: S - inset * 2, h: S - inset * 2 };
  const opts: FitOptions = look === "seal" ? { mode: "fill", maxStretch: 2, pad: 0.03 } : { mode: "fill", maxStretch: 1.5, pad: 0.05 };
  const rh = box.h / lines.length;
  lines.forEach((line, r) => {
    const cw = box.w / line.length;
    const cells = line.map((_, i) => ({ x: box.x + i * cw, y: box.y + r * rh, w: cw, h: rh }));
    prims.push(...glyphsInCells(line, cells, font, opts));
  });
  return { key, size: S, color: STAMP_RED, prims };
}

function corporateRound(key: string, company: string, title: string, font: FontRef, look: "seal" | "plain" | "bold"): StampSpec {
  const ring = chars(company).slice(0, 16);
  const inner = [...chars(title).slice(0, 6), "인"];
  const outerR = 142;
  const innerR = 86;
  const sw = look === "bold" ? 11 : 8;
  const prims: StampPrim[] = [
    { t: "ellipse", cx: C, cy: C, rx: outerR, ry: outerR, sw },
    { t: "ellipse", cx: C, cy: C, rx: innerR, ry: innerR, sw: look === "bold" ? 6 : 4 },
  ];
  // company name around the ring, centred at the top, reading clockwise
  const n = ring.length;
  if (n > 0) {
    const band = outerR - innerR - sw;
    const radius = innerR + 2 + band / 2 + 2;
    const span = Math.min(Math.PI * 2 * (n >= 10 ? 0.92 : 0.84), n * 0.52);
    const step = span / n;
    const gw = Math.min(radius * step * 0.92, band * 1.05);
    const gh = band * 0.94;
    ring.forEach((ch, i) => {
      const angle = -span / 2 + step * (i + 0.5);
      const px = C + radius * Math.sin(angle);
      const py = C - radius * Math.cos(angle);
      const g = fitRotated(ch, font, gw, gh, angle, px, py, { mode: "fill", maxStretch: 1.4, pad: 0.02 });
      if (g) prims.push(g);
    });
  }
  // 대표이사인 inside the inner circle (대표이 / 사인), read left→right like the square faces
  const side = innerR * 1.42;
  const box: Box = { x: C - side / 2, y: C - side / 2, w: side, h: side };
  const cells = gridCells(inner.length, box, squareRows(inner.length));
  prims.push(...glyphsInCells(inner, cells, font, { mode: "fill", maxStretch: look === "seal" ? 2 : 1.5, pad: 0.05 }));
  return { key, size: S, color: STAMP_RED, prims };
}

/** 법인 도장 variants: 4 square seals ("{회사명}{직함}인") + 4 round seals (name on the ring, 직함 inside). */
export async function corporateStamps(company: string, title: string): Promise<StampSpec[]> {
  const name = company.trim();
  const role = title.trim() || "대표이사";
  if (!name) return [];
  const F = STAMP_FONTS;
  await ensureFonts([F.seal, F.serif, F.bold, F.brush], name + role + "인");
  return [
    corporateSquare("corp-square-brush", name, role, F.brush, "plain"),
    corporateSquare("corp-square-serif", name, role, F.serif, "plain"),
    corporateSquare("corp-square-seal", name, role, F.seal, "seal"),
    corporateSquare("corp-square-bold", name, role, F.bold, "bold"),
    corporateRound("corp-round-brush", name, role, F.brush, "plain"),
    corporateRound("corp-round-serif", name, role, F.serif, "plain"),
    corporateRound("corp-round-seal", name, role, F.seal, "seal"),
    corporateRound("corp-round-bold", name, role, F.bold, "bold"),
  ];
}

/* ------------------------------------------------------------ raster */

/** Draws a stamp description onto a transparent canvas and returns a PNG data URL (default 300×300). */
export function stampToPng(spec: StampSpec, out = STAMP_SIZE): string {
  const c = createCanvas(out, out);
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context is not available");
  const k = out / spec.size;
  ctx.scale(k, k);
  ctx.strokeStyle = spec.color;
  ctx.fillStyle = spec.color;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  for (const p of spec.prims) {
    if (p.t === "ellipse") {
      ctx.lineWidth = p.sw;
      ctx.beginPath();
      ctx.ellipse(p.cx, p.cy, p.rx, p.ry, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (p.t === "rect") {
      ctx.lineWidth = p.sw;
      ctx.beginPath();
      ctx.roundRect(p.x, p.y, p.w, p.h, p.r);
      ctx.stroke();
    } else {
      ctx.save();
      ctx.transform(...p.m);
      ctx.font = fontCss(p.font, p.size);
      ctx.fillText(p.ch, 0, 0);
      ctx.restore();
    }
  }
  return toPng(c);
}
