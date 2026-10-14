/**
 * Framework-free canvas helpers for the signature / stamp dialogs:
 * pen strokes (draw + validate), handwriting-font text, uploaded images, trimming → PNG data URLs.
 * Browser only (uses document / canvas).
 */
import type { FontRef, SignStyle } from "./fonts";

/** Ink colour of drawn / generated signatures (content colour, theme independent) */
export const INK = "#000000";

/* ------------------------------------------------------------------ fonts */

export function fontCss(font: FontRef, px: number) {
  return `${font.weight} ${px}px ${font.family}`;
}

/** Waits until the given fonts (and the unicode-range slices covering `text`) are loaded. */
export async function ensureFonts(fonts: FontRef[], text: string, timeoutMs = 8000): Promise<void> {
  if (typeof document === "undefined" || !("fonts" in document)) return;
  const sample = text.trim() || "가A";
  const unique = Array.from(new Map(fonts.map((f) => [`${f.weight}|${f.family}`, f])).values());
  const loading = Promise.all(
    unique.map((f) => document.fonts.load(fontCss(f, 64), sample).catch(() => [] as FontFace[])),
  ).then(() => undefined);
  await Promise.race([loading, new Promise<void>((r) => setTimeout(r, timeoutMs))]);
}

/* --------------------------------------------------------------- canvases */

export function createCanvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

let measureCtx: CanvasRenderingContext2D | null = null;
/** Shared 2d context for text measurement */
export function measureContext() {
  if (!measureCtx) measureCtx = createCanvas(8, 8).getContext("2d");
  if (!measureCtx) throw new Error("Canvas 2D context is not available");
  return measureCtx;
}

/** Bounding box of the pixels whose alpha is above `threshold`, or null for an empty canvas. */
export function alphaBounds(canvas: HTMLCanvasElement, threshold = 8) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  const { width: w, height: h } = canvas;
  const data = ctx.getImageData(0, 0, w, h).data;
  let minX = w,
    minY = h,
    maxX = -1,
    maxY = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let x = 0; x < w; x++) {
      if (data[row + x * 4 + 3] > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** Crops a canvas to its visible pixels (+ padding). Returns null when nothing is drawn. */
export function trimCanvas(canvas: HTMLCanvasElement, pad = 8): HTMLCanvasElement | null {
  const b = alphaBounds(canvas);
  if (!b) return null;
  const out = createCanvas(b.w + pad * 2, b.h + pad * 2);
  out.getContext("2d")?.drawImage(canvas, b.x, b.y, b.w, b.h, pad, pad, b.w, b.h);
  return out;
}

export function toPng(canvas: HTMLCanvasElement) {
  return canvas.toDataURL("image/png");
}

/* ---------------------------------------------------------------- strokes */

export interface StrokePoint {
  x: number;
  y: number;
  /** pen width at this point (logical px) */
  w: number;
}
export type Stroke = StrokePoint[];

const mid = (a: StrokePoint, b: StrokePoint): StrokePoint => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, w: (a.w + b.w) / 2 });

/**
 * Draws segment `i` (1-based, ending at point i) of a stroke with quadratic smoothing:
 * the curve runs from the midpoint of (i-2, i-1) to the midpoint of (i-1, i) with point i-1 as control.
 * Pass `final` to draw the closing segment to the last point.
 */
export function drawStrokeSegment(ctx: CanvasRenderingContext2D, s: Stroke, i: number, scale = 1, final = false) {
  if (s.length === 0) return;
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (s.length === 1) {
    if (!final) return;
    const p = s[0];
    ctx.beginPath();
    ctx.arc(p.x * scale, p.y * scale, (p.w / 2) * scale, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  if (final) {
    const a = s.length >= 2 ? mid(s[s.length - 2], s[s.length - 1]) : s[0];
    const b = s[s.length - 1];
    ctx.lineWidth = ((a.w + b.w) / 2) * scale;
    ctx.beginPath();
    ctx.moveTo(a.x * scale, a.y * scale);
    ctx.lineTo(b.x * scale, b.y * scale);
    ctx.stroke();
    return;
  }
  if (i < 1 || i >= s.length) return;
  const start = i === 1 ? s[0] : mid(s[i - 2], s[i - 1]);
  const ctrl = s[i - 1];
  const end = mid(s[i - 1], s[i]);
  ctx.lineWidth = ((start.w + end.w) / 2) * scale;
  ctx.beginPath();
  ctx.moveTo(start.x * scale, start.y * scale);
  ctx.quadraticCurveTo(ctrl.x * scale, ctrl.y * scale, end.x * scale, end.y * scale);
  ctx.stroke();
}

export function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke, scale = 1) {
  for (let i = 1; i < s.length; i++) drawStrokeSegment(ctx, s, i, scale);
  drawStrokeSegment(ctx, s, s.length - 1, scale, true);
}

/** Renders strokes (logical coordinates) to a trimmed transparent PNG at `scale`× resolution. */
export function strokesToPng(strokes: Stroke[], width: number, height: number, scale = 2): string | null {
  const c = createCanvas(width * scale, height * scale);
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  for (const s of strokes) drawStroke(ctx, s, scale);
  const trimmed = trimCanvas(c, 6 * scale);
  return trimmed ? toPng(trimmed) : null;
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

function pathLength(s: Stroke) {
  let l = 0;
  for (let i = 1; i < s.length; i++) l += dist(s[i - 1], s[i]);
  return l;
}

/** A stroke counts as "straight" when every point stays close to the chord between its ends. */
function isNearlyStraight(s: Stroke) {
  const len = pathLength(s);
  if (len < 14) return true; // dots / ticks
  const a = s[0];
  const b = s[s.length - 1];
  const chord = dist(a, b);
  let maxDev = 0;
  if (chord < 1) {
    for (const p of s) maxDev = Math.max(maxDev, dist(p, a));
  } else {
    for (const p of s) {
      const dev = Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / chord;
      if (dev > maxDev) maxDev = dev;
    }
  }
  return maxDev < Math.max(5, chord * 0.08) && chord / len > 0.9;
}

/**
 * Heuristic used on 입력하기: rejects drawings that cannot be a real signature —
 * too little ink, only straight lines, or a few short strokes in a small area.
 */
export function validateDrawing(strokes: Stroke[], canvasWidth: number): boolean {
  const used = strokes.filter((s) => s.length > 0);
  if (used.length === 0) return false;
  const total = used.reduce((sum, s) => sum + pathLength(s), 0);
  if (total < 120) return false;
  if (used.every(isNearlyStraight)) return false;
  let minX = Infinity,
    maxX = -Infinity;
  for (const s of used)
    for (const p of s) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
    }
  const wide = maxX - minX >= canvasWidth * 0.25;
  if (used.length < 3 && total < 250 && !wide) return false;
  return true;
}

/* ------------------------------------------------------- handwriting text */

/** Renders `text` in a handwriting style to a trimmed transparent PNG (black ink). */
export function renderTextSignature(text: string, style: SignStyle, basePx = 110): string | null {
  const value = text.trim();
  if (!value) return null;
  const px = Math.round(basePx * (style.scale ?? 1));
  const m = measureContext();
  m.font = fontCss(style.font, px);
  const mt = m.measureText(value);
  const asc = Math.max(mt.actualBoundingBoxAscent, px * 0.6);
  const desc = Math.max(mt.actualBoundingBoxDescent, px * 0.25);
  const textW = mt.actualBoundingBoxLeft + mt.actualBoundingBoxRight;
  const skew = style.skew ?? 0;
  const slant = Math.abs(skew) * (asc + desc);
  const pad = 24;
  const c = createCanvas(textW + slant * 2 + pad * 2, asc + desc + pad * 2);
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  ctx.font = fontCss(style.font, px);
  ctx.fillStyle = INK;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.setTransform(1, 0, skew, 1, pad + slant + mt.actualBoundingBoxLeft, pad + asc);
  ctx.fillText(value, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const trimmed = trimCanvas(c, 10);
  return trimmed ? toPng(trimmed) : null;
}

/* --------------------------------------------------------- uploaded image */

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const UPLOAD_TYPES = ["image/png", "image/jpeg"];

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("이미지를 불러올 수 없습니다."));
    img.src = src;
  });
}

/**
 * Turns an uploaded PNG/JPG into a trimmed transparent PNG:
 * scales it down (longest side ≤ maxSide) and, when `removeWhite`, makes the (near) white
 * background transparent with a soft threshold so anti-aliased edges stay smooth.
 */
export async function processUploadedImage(
  file: File,
  { removeWhite = true, maxSide = 800 }: { removeWhite?: boolean; maxSide?: number } = {},
): Promise<string | null> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const ratio = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * ratio));
    const h = Math.max(1, Math.round(img.naturalHeight * ratio));
    const c = createCanvas(w, h);
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);
    if (removeWhite) {
      const image = ctx.getImageData(0, 0, w, h);
      const d = image.data;
      const HARD = 235; // ≥ this on every channel → fully transparent
      const SOFT = 200; // between SOFT and HARD → partially transparent
      for (let i = 0; i < d.length; i += 4) {
        const min = Math.min(d[i], d[i + 1], d[i + 2]);
        if (min >= HARD) d[i + 3] = 0;
        else if (min > SOFT) d[i + 3] = Math.round(d[i + 3] * ((HARD - min) / (HARD - SOFT)));
      }
      ctx.putImageData(image, 0, 0);
    }
    const trimmed = trimCanvas(c, 8);
    return trimmed ? toPng(trimmed) : null;
  } finally {
    URL.revokeObjectURL(url);
  }
}
