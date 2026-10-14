import type { Color, PDFFont, PDFPage } from "pdf-lib";

import { PDF_FONT_FEATURES, baselineOffset } from "../../_edit-kit/text-layout";

/**
 * 서식 작성기 → A4 PDF. The editor DOM is converted to a flat list of blocks
 * (`parseDraftDom`) which are laid out with Pretendard metrics (`renderDraftPdf`):
 * margins 20mm, word wrapping, headings, bullet / numbered lists, dividers, alignment,
 * bold / italic (oblique) / underline runs and automatic page breaks.
 *
 * The on-screen sheet (794px wide, 1px = 0.75pt) uses the same sizes, see `SHEET_CSS`.
 */

export type BlockStyle = "p" | "h1" | "h2";
export type Align = "left" | "center" | "right" | "justify";

export interface Run {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
}

export type Marker = { kind: "bullet"; level: number } | { kind: "number"; value: number };

export type DraftBlock =
  | { kind: "text"; style: BlockStyle; align: Align; runs: Run[]; indent: number; marker?: Marker }
  | { kind: "hr" };

export const PAGE = { w: 595.28, h: 841.89 };
export const MARGIN = 56.69; // 20mm
export const INDENT = 18; // 24px list padding
const TEXT_RGB: [number, number, number] = [0.09, 0.09, 0.09];

export const BLOCK_STYLES: Record<BlockStyle, { size: number; lh: number; before: number; after: number }> = {
  p: { size: 10.5, lh: 1.6, before: 0, after: 0 },
  h1: { size: 19.5, lh: 1.35, before: 9, after: 6 },
  h2: { size: 15, lh: 1.4, before: 7.5, after: 4.5 },
};
const HR_MARGIN = 9;

/* ------------------------------------------------------------------ DOM → blocks */

interface Ctx {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  style: BlockStyle;
  align: Align;
  indent: number;
}

function alignOf(el: HTMLElement, fallback: Align): Align {
  const a = el.style?.textAlign;
  if (a === "center" || a === "right" || a === "justify" || a === "left") return a;
  if (a === "start") return "left";
  if (a === "end") return "right";
  return fallback;
}

export function parseDraftDom(root: HTMLElement): DraftBlock[] {
  const blocks: DraftBlock[] = [];
  let cur: Extract<DraftBlock, { kind: "text" }> | null = null;
  let pendingMarker: Marker | undefined;

  const flush = () => {
    if (cur) {
      // a trailing <br> at the end of a block does not create an extra line
      const last = cur.runs[cur.runs.length - 1];
      if (last?.text === "\n" && cur.runs.some((r) => r.text !== "\n" && r.text.trim())) cur.runs.pop();
      blocks.push(cur);
      cur = null;
    }
  };
  const ensure = (ctx: Ctx) => {
    if (!cur) {
      cur = { kind: "text", style: ctx.style, align: ctx.align, runs: [], indent: ctx.indent, marker: pendingMarker };
      pendingMarker = undefined;
    }
    return cur;
  };
  const pushText = (text: string, ctx: Ctx) => {
    if (!text) return;
    const block = cur;
    // whitespace at the start of a line collapses
    const lastText = block?.runs[block.runs.length - 1]?.text ?? "";
    if ((!block || !block.runs.length || lastText.endsWith("\n") || lastText.endsWith(" ")) && /^ +/.test(text)) text = text.replace(/^ +/, "");
    if (!text) return;
    ensure(ctx).runs.push({ text, bold: ctx.bold || ctx.style !== "p", italic: ctx.italic, underline: ctx.underline });
  };

  const walk = (node: Node, ctx: Ctx) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = (node.nodeValue ?? "").replace(/[\t\n\r ]+/g, " ").replace(/ /g, " ");
      pushText(t, ctx);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();
    switch (tag) {
      case "br":
        ensure(ctx).runs.push({ text: "\n", bold: false, italic: false, underline: false });
        return;
      case "hr":
        flush();
        blocks.push({ kind: "hr" });
        return;
      case "p":
      case "div":
      case "h1":
      case "h2": {
        flush();
        const next: Ctx = { ...ctx, style: tag === "h1" || tag === "h2" ? tag : ctx.style, align: alignOf(el, ctx.align) };
        el.childNodes.forEach((c) => walk(c, next));
        // (an element without any content has no height in the browser either;
        //  a blank line is `<p><br></p>`, which the <br> case above turns into an empty line)
        if (!cur && pendingMarker) ensure(next);
        flush();
        return;
      }
      case "ul":
      case "ol": {
        flush();
        let n = 1;
        const level = ctx.indent + 1;
        el.childNodes.forEach((c) => {
          if (c.nodeType === Node.ELEMENT_NODE && (c as HTMLElement).tagName.toLowerCase() === "li") {
            flush();
            pendingMarker = tag === "ol" ? { kind: "number", value: n++ } : { kind: "bullet", level };
            const liCtx: Ctx = { ...ctx, style: "p", indent: level, align: alignOf(c as HTMLElement, ctx.align) };
            c.childNodes.forEach((cc) => walk(cc, liCtx));
            if (pendingMarker) ensure(liCtx);
            flush();
          } else {
            walk(c, { ...ctx, indent: level });
          }
        });
        flush();
        return;
      }
      case "li": {
        flush();
        pendingMarker = { kind: "bullet", level: ctx.indent + 1 };
        const liCtx: Ctx = { ...ctx, indent: ctx.indent + 1 };
        el.childNodes.forEach((c) => walk(c, liCtx));
        if (pendingMarker) ensure(liCtx);
        flush();
        return;
      }
      case "strong":
      case "b":
        el.childNodes.forEach((c) => walk(c, { ...ctx, bold: true }));
        return;
      case "em":
      case "i":
        el.childNodes.forEach((c) => walk(c, { ...ctx, italic: true }));
        return;
      case "u":
        el.childNodes.forEach((c) => walk(c, { ...ctx, underline: true }));
        return;
      default:
        el.childNodes.forEach((c) => walk(c, ctx));
    }
  };

  root.childNodes.forEach((c) => walk(c, { bold: false, italic: false, underline: false, style: "p", align: "left", indent: 0 }));
  flush();
  // drop trailing blank paragraphs
  while (blocks.length) {
    const b = blocks[blocks.length - 1];
    if (b.kind === "text" && !b.marker && !b.runs.some((r) => r.text.trim())) blocks.pop();
    else break;
  }
  return blocks;
}

/* ------------------------------------------------------------------ layout + PDF */

interface Part {
  text: string;
  run: Run;
  width: number;
}
interface Unit {
  kind: "word" | "space" | "break";
  parts: Part[];
  width: number;
}
interface Line {
  parts: Part[];
  width: number;
}

function cleanText(s: string) {
  return s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}

function toUnits(runs: Run[], measure: (s: string, run: Run) => number): Unit[] {
  const units: Unit[] = [];
  for (const run of runs) {
    if (run.text === "\n") {
      units.push({ kind: "break", parts: [], width: 0 });
      continue;
    }
    for (const tok of cleanText(run.text).match(/\n| +|[^ \n]+/g) ?? []) {
      if (tok === "\n") {
        units.push({ kind: "break", parts: [], width: 0 });
        continue;
      }
      const kind = tok.startsWith(" ") ? "space" : "word";
      const part = { text: tok, run, width: measure(tok, run) };
      const prev = units[units.length - 1];
      // words split over several styled runs stay together (e.g. **굵**게)
      if (kind === "word" && prev?.kind === "word") {
        prev.parts.push(part);
        prev.width += part.width;
      } else units.push({ kind, parts: [part], width: part.width });
    }
  }
  return units;
}

function layoutLines(units: Unit[], maxWidth: number, measure: (s: string, run: Run) => number): Line[] {
  const lines: Line[] = [];
  let parts: Part[] = [];
  let width = 0;
  const trimmedWidth = () => {
    let w = width;
    for (let i = parts.length - 1; i >= 0 && !parts[i].text.trim(); i--) w -= parts[i].width;
    return w;
  };
  const push = () => {
    const w = trimmedWidth();
    while (parts.length && !parts[parts.length - 1].text.trim()) parts.pop();
    lines.push({ parts, width: w });
    parts = [];
    width = 0;
  };
  const hasContent = () => parts.some((p) => p.text.trim());

  for (const u of units) {
    if (u.kind === "break") {
      push();
      continue;
    }
    if (u.kind === "space") {
      if (hasContent()) {
        parts.push(...u.parts);
        width += u.width;
      }
      continue;
    }
    if (width + u.width <= maxWidth) {
      parts.push(...u.parts);
      width += u.width;
      continue;
    }
    if (hasContent()) push();
    if (u.width <= maxWidth) {
      parts.push(...u.parts);
      width += u.width;
      continue;
    }
    // a single word wider than the line: break between characters
    for (const p of u.parts) {
      for (const ch of Array.from(p.text)) {
        const w = measure(ch, p.run);
        if (hasContent() && width + w > maxWidth) push();
        const last = parts[parts.length - 1];
        if (last && last.run === p.run && last.text.trim()) {
          last.text += ch;
          last.width += w;
        } else parts.push({ text: ch, run: p.run, width: w });
        width += w;
      }
    }
  }
  if (parts.length || !lines.length) push();
  return lines;
}

/** Merges neighbouring parts with identical styling so each line needs few drawText calls. */
function mergeParts(parts: Part[]): Part[] {
  const out: Part[] = [];
  for (const p of parts) {
    const last = out[out.length - 1];
    if (last && last.run.bold === p.run.bold && last.run.italic === p.run.italic && last.run.underline === p.run.underline) {
      last.text += p.text;
      last.width += p.width;
    } else out.push({ ...p });
  }
  return out;
}

export async function renderDraftPdf(
  blocks: DraftBlock[],
  opts: { title: string; loadFont: (kind: "regular" | "bold") => Promise<ArrayBuffer> },
): Promise<Uint8Array> {
  const lib = await import("pdf-lib");
  const fontkit = (await import("@pdf-lib/fontkit")).default;
  const { PDFDocument, rgb, degrees } = lib;

  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  pdf.setTitle(opts.title);
  pdf.setCreator("OpenSign 서식 작성기");
  pdf.setProducer("OpenSign");

  const needsBold = blocks.some((b) => b.kind === "text" && b.runs.some((r) => r.bold));
  const regular = await pdf.embedFont(await opts.loadFont("regular"), { subset: false, features: PDF_FONT_FEATURES });
  const bold: PDFFont = needsBold ? await pdf.embedFont(await opts.loadFont("bold"), { subset: false, features: PDF_FONT_FEATURES }) : regular;

  const color = rgb(...TEXT_RGB);
  const contentW = PAGE.w - MARGIN * 2;
  const bottom = PAGE.h - MARGIN;

  let page: PDFPage = pdf.addPage([PAGE.w, PAGE.h]);
  let y = MARGIN;
  let pendingAfter = 0;
  let atTop = true;
  const newPage = () => {
    page = pdf.addPage([PAGE.w, PAGE.h]);
    y = MARGIN;
    atTop = true;
  };

  for (const block of blocks) {
    if (block.kind === "hr") {
      const gap = Math.max(pendingAfter, HR_MARGIN);
      if (y + gap + HR_MARGIN > bottom) newPage();
      else y += atTop ? 0 : gap;
      page.drawLine({
        start: { x: MARGIN, y: PAGE.h - y },
        end: { x: PAGE.w - MARGIN, y: PAGE.h - y },
        thickness: 0.75,
        color: rgb(0.82, 0.82, 0.82),
      });
      y += 0.75;
      pendingAfter = HR_MARGIN;
      atTop = false;
      continue;
    }

    const st = BLOCK_STYLES[block.style];
    const size = st.size;
    const lineH = size * st.lh;
    const fontFor = (run: Run) => (run.bold ? bold : regular);
    const measure = (s: string, run: Run) => fontFor(run).widthOfTextAtSize(s, size);
    const left = MARGIN + block.indent * INDENT;
    const maxWidth = Math.max(40, contentW - block.indent * INDENT);
    const lines = layoutLines(toUnits(block.runs, measure), maxWidth, measure);

    if (!atTop) y += Math.max(pendingAfter, st.before);
    lines.forEach((line, li) => {
      if (y + lineH > bottom + 0.01) newPage();
      const baseline = y + baselineOffset(size, lineH);
      const pdfY = PAGE.h - baseline;
      let x = left;
      if (block.align === "center") x += (maxWidth - line.width) / 2;
      else if (block.align === "right") x += maxWidth - line.width;

      if (li === 0 && block.marker) drawMarker(page, block.marker, left, baseline, size, regular, color);

      for (const part of mergeParts(line.parts)) {
        if (part.text) {
          page.drawText(part.text, {
            x,
            y: pdfY,
            size,
            font: fontFor(part.run),
            color,
            ySkew: part.run.italic ? degrees(12) : undefined,
          });
          if (part.run.underline && part.text.trim()) {
            page.drawLine({
              start: { x, y: pdfY - size * 0.14 },
              end: { x: x + part.width, y: pdfY - size * 0.14 },
              thickness: Math.max(0.5, size * 0.06),
              color,
            });
          }
        }
        x += part.width;
      }
      y += lineH;
      atTop = false;
    });
    pendingAfter = st.after;
  }

  return pdf.save();
}

function drawMarker(
  page: PDFPage,
  marker: Marker,
  left: number,
  baseline: number,
  size: number,
  font: PDFFont,
  color: Color,
) {
  const gutterRight = left - size * 0.55;
  if (marker.kind === "number") {
    const label = `${marker.value}.`;
    const w = font.widthOfTextAtSize(label, size);
    page.drawText(label, { x: gutterRight - w, y: PAGE.h - baseline, size, font, color });
    return;
  }
  const r = size * 0.17;
  const cx = gutterRight - r;
  const cy = PAGE.h - (baseline - size * 0.33);
  const level = ((marker.level - 1) % 3) + 1;
  if (level === 1) page.drawCircle({ x: cx, y: cy, size: r, color });
  else if (level === 2) page.drawCircle({ x: cx, y: cy, size: r * 0.9, borderColor: color, borderWidth: Math.max(0.5, size * 0.06) });
  else page.drawRectangle({ x: cx - r, y: cy - r, width: r * 2, height: r * 2, color });
}
