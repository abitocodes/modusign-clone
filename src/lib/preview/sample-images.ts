/**
 * Tiny PNG painter for the preview seed: hand-drawn looking signatures and a seal, rendered
 * procedurally (anti-aliased strokes) and encoded without any image library. Fictional only.
 */
import { deflateSync } from "node:zlib";

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array) {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** RGBA (8 bit) → PNG bytes */
export function encodePng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const raw = new Uint8Array((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", new Uint8Array(deflateSync(raw))),
    chunk("IEND", new Uint8Array()),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

class Canvas {
  w: number;
  h: number;
  alpha: Float32Array;
  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.alpha = new Float32Array(w * h);
  }
  /** anti-aliased round-capped segment */
  segment(x0: number, y0: number, x1: number, y1: number, r: number) {
    const minX = Math.max(0, Math.floor(Math.min(x0, x1) - r - 1));
    const maxX = Math.min(this.w - 1, Math.ceil(Math.max(x0, x1) + r + 1));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1) - r - 1));
    const maxY = Math.min(this.h - 1, Math.ceil(Math.max(y0, y1) + r + 1));
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len2 = dx * dx + dy * dy || 1;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        const t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / len2));
        const d = Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy));
        const a = Math.max(0, Math.min(1, r + 0.5 - d));
        const i = y * this.w + x;
        if (a > this.alpha[i]) this.alpha[i] = a;
      }
    }
  }
  path(points: [number, number][], r: number | ((i: number) => number)) {
    for (let i = 1; i < points.length; i++) {
      const rr = typeof r === "number" ? r : r(i);
      this.segment(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1], rr);
    }
  }
  ring(cx: number, cy: number, radius: number, r: number) {
    const pts: [number, number][] = [];
    for (let i = 0; i <= 96; i++) pts.push([cx + radius * Math.cos((i / 96) * Math.PI * 2), cy + radius * Math.sin((i / 96) * Math.PI * 2)]);
    this.path(pts, r);
  }
  png(color: [number, number, number]) {
    const rgba = new Uint8Array(this.w * this.h * 4);
    for (let i = 0; i < this.alpha.length; i++) {
      rgba[i * 4] = color[0];
      rgba[i * 4 + 1] = color[1];
      rgba[i * 4 + 2] = color[2];
      rgba[i * 4 + 3] = Math.round(this.alpha[i] * 255);
    }
    return encodePng(this.w, this.h, rgba);
  }
}

const dataUrl = (png: Uint8Array) => `data:image/png;base64,${Buffer.from(png).toString("base64")}`;

/** Deterministic pseudo-random numbers (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A cursive scribble that reads as a hand-written signature (240×96, transparent). */
export function signaturePngDataUrl(seed: number): string {
  const W = 240;
  const H = 96;
  const c = new Canvas(W, H);
  const rand = rng(seed * 7919 + 17);
  const loops = 3 + Math.floor(rand() * 3);
  const amp = 14 + rand() * 8;
  const phase = rand() * Math.PI * 2;
  const pts: [number, number][] = [];
  const steps = 260;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const env = Math.sin(Math.PI * Math.min(1, t * 1.15)) * 0.85 + 0.15;
    const x = 22 + 190 * t + 9 * Math.sin(2 * Math.PI * loops * 2 * t + phase);
    const y = 46 + amp * env * Math.sin(2 * Math.PI * loops * t + phase) + 8 * Math.cos(2 * Math.PI * loops * 2 * t + phase);
    pts.push([x, y]);
  }
  c.path(pts, (i) => 1.5 + 0.9 * Math.sin((i / steps) * Math.PI));
  // flourish underline
  const under: [number, number][] = [];
  for (let i = 0; i <= 60; i++) {
    const t = i / 60;
    under.push([30 + 180 * t, 76 + 4 * Math.sin(Math.PI * t) - 6 * t]);
  }
  c.path(under, 1.3);
  return dataUrl(c.png([28, 38, 84]));
}

/** A round red seal (도장) with a simple geometric mark (120×120, transparent). */
export function stampPngDataUrl(): string {
  const S = 120;
  const c = new Canvas(S, S);
  c.ring(60, 60, 53, 3.2);
  c.ring(60, 60, 45, 1.2);
  // four blocks of strokes, like an engraved seal
  const blocks: [number, number][] = [
    [38, 38],
    [82, 38],
    [38, 82],
    [82, 82],
  ];
  blocks.forEach(([x, y], i) => {
    c.segment(x - 12, y - 10, x + 12, y - 10, 2.4);
    c.segment(x - 12, y + 10, x + 12, y + 10, 2.4);
    if (i % 2 === 0) c.segment(x, y - 12, x, y + 12, 2.4);
    else {
      c.segment(x - 12, y, x + 12, y, 2.4);
      c.segment(x - 6, y - 10, x - 6, y + 10, 2);
    }
  });
  return dataUrl(c.png([211, 47, 47]));
}
