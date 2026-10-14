import "server-only";

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import fontkit from "@pdf-lib/fontkit";
import { LineCapStyle, PDFDocument, degrees, rgb, type PDFFont, type PDFImage, type PDFPage, type RGB } from "pdf-lib";

import { participantStatusLabel } from "@/lib/documents/view";
import { describeEvent } from "@/lib/events";
import { paths } from "@/lib/storage";
import { downloadBytes, uploadBytes } from "@/lib/storage-server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { DocumentEvent, DocumentRow, FieldOptions, FieldType, Participant, Profile } from "@/lib/types";

/**
 * Completed-document generation (pdf-lib + @pdf-lib/fontkit, Pretendard).
 *
 *  - every filled field is drawn onto the original pages (images contained in their box keeping the
 *    aspect ratio, text vertically centred, check marks, dates); field geometry is stored in PDF
 *    points from the TOP-LEFT of the displayed page, converted here to pdf-lib's bottom-left space
 *    (page rotation and crop box offsets included)
 *  - "OpenSign Document ID : {id} - p / n" is stamped on each original page
 *  - a Korean 감사 추적 인증서 (audit trail certificate) is appended, and also built as a separate PDF
 *    that additionally carries the SHA-256 of the completed PDF (원본 검증키)
 *
 * Fonts: @pdf-lib/fontkit cannot read the CFF outlines of Pretendard's OTF build, and its subsetter
 * drops Hangul glyphs, so the TrueType build of the same package is embedded in full.
 */

/* ------------------------------------------------------------------- fonts */

const FONT_DIRS = [
  // public/fonts holds the TTF copies (see next.config outputFileTracingIncludes)
  path.join(/*turbopackIgnore: true*/ process.cwd(), "public", "fonts"),
  path.join(/*turbopackIgnore: true*/ process.cwd(), "node_modules", "pretendard", "dist", "public", "static", "alternative"),
];

let fontBytes: Promise<{ regular: Uint8Array; bold: Uint8Array }> | null = null;

async function readFont(file: string) {
  for (const dir of FONT_DIRS) {
    try {
      return new Uint8Array(await readFile(path.join(/*turbopackIgnore: true*/ dir, file)));
    } catch {
      // try the next location
    }
  }
  throw new Error(`글꼴 파일(${file})을 찾을 수 없습니다.`);
}

function loadFontBytes() {
  if (!fontBytes) {
    fontBytes = Promise.all([readFont("Pretendard-Regular.ttf"), readFont("Pretendard-Bold.ttf")])
      .then(([regular, bold]) => ({ regular, bold }))
      .catch((e) => {
        fontBytes = null;
        throw e;
      });
  }
  return fontBytes;
}

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
}

async function embedFonts(doc: PDFDocument, opts: { bold?: boolean } = {}): Promise<Fonts> {
  const bytes = await loadFontBytes();
  doc.registerFontkit(fontkit);
  // `clig` swaps "-" / ":" between digits for case variants that pdf-lib cannot space or extract.
  const regular = await doc.embedFont(bytes.regular, { subset: false, features: { calt: false, clig: false } });
  const bold = opts.bold === false ? regular : await doc.embedFont(bytes.bold, { subset: false, features: { calt: false, clig: false } });
  return { regular, bold };
}

/* --------------------------------------------------------------- geometry */

interface PageGeo {
  x0: number;
  y0: number;
  w: number;
  h: number;
  rot: 0 | 90 | 180 | 270;
  /** displayed (rotated) size — what the field coordinates refer to */
  W: number;
  H: number;
}

function pageGeo(page: PDFPage): PageGeo {
  const box = page.getCropBox();
  const angle = (((page.getRotation().angle ?? 0) % 360) + 360) % 360;
  const rot = (angle === 90 || angle === 180 || angle === 270 ? angle : 0) as PageGeo["rot"];
  const swap = rot === 90 || rot === 270;
  return { x0: box.x, y0: box.y, w: box.width, h: box.height, rot, W: swap ? box.height : box.width, H: swap ? box.width : box.height };
}

/** displayed top-left coordinates → PDF user space (bottom-left origin, unrotated) */
function toPdf(g: PageGeo, dx: number, dy: number) {
  switch (g.rot) {
    case 90:
      return { x: g.x0 + dy, y: g.y0 + dx };
    case 180:
      return { x: g.x0 + g.w - dx, y: g.y0 + dy };
    case 270:
      return { x: g.x0 + g.w - dy, y: g.y0 + g.h - dx };
    default:
      return { x: g.x0 + dx, y: g.y0 + g.h - dy };
  }
}

const INK: RGB = rgb(0x29 / 255, 0x29 / 255, 0x29 / 255);
const CHECK: RGB = rgb(0x21 / 255, 0x21 / 255, 0x21 / 255);
const GREY: RGB = rgb(0x75 / 255, 0x75 / 255, 0x75 / 255);
const LIGHT: RGB = rgb(0xe0 / 255, 0xe0 / 255, 0xe0 / 255);
const HEAD_BG: RGB = rgb(0xf4 / 255, 0xf4 / 255, 0xf4 / 255);
const NAVY: RGB = rgb(0x28 / 255, 0x30 / 255, 0x3c / 255);

/** text drawn at a displayed position (baseline), upright for the viewer */
function drawTextAt(page: PDFPage, g: PageGeo, text: string, dx: number, baseline: number, size: number, font: PDFFont, color: RGB = INK) {
  if (!text) return;
  const p = toPdf(g, dx, baseline);
  page.drawText(text, { x: p.x, y: p.y, size, font, color, rotate: degrees(g.rot) });
}

/** strips characters the content stream cannot carry */
function clean(text: string) {
  return text.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ");
}

/*
 * Text measuring. pdf-lib draws glyphs with their plain advance widths (no kerning), so the sum of
 * per-character widths is what ends up on the page — and caching it per font keeps wrapping linear
 * (a fontkit layout per call is slow).
 */
const charWidths = new WeakMap<PDFFont, Map<string, number>>();

function textWidth(font: PDFFont, text: string, size: number) {
  let cache = charWidths.get(font);
  if (!cache) {
    cache = new Map();
    charWidths.set(font, cache);
  }
  let units = 0;
  for (const ch of Array.from(text)) {
    let w = cache.get(ch);
    if (w === undefined) {
      w = font.widthOfTextAtSize(ch, 1000);
      cache.set(ch, w);
    }
    units += w;
  }
  return (units * size) / 1000;
}

/** wraps text into lines that fit `maxWidth` (prefers breaking at spaces) */
function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const para of clean(text).replace(/\r/g, "").split("\n")) {
    let line = "";
    let width = 0;
    for (const ch of Array.from(para)) {
      const w = textWidth(font, ch, size);
      if (line && width + w > maxWidth) {
        const cut = line.lastIndexOf(" ");
        if (cut > 0 && ch !== " ") {
          lines.push(line.slice(0, cut));
          line = line.slice(cut + 1) + ch;
        } else {
          lines.push(line);
          line = ch === " " ? "" : ch;
        }
        width = textWidth(font, line, size);
      } else {
        line += ch;
        width += w;
      }
    }
    lines.push(line);
  }
  return lines;
}

/* ------------------------------------------------------------------ fields */

export interface StampField {
  type: FieldType;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  options: FieldOptions | null;
  value: string | null;
}

const DATA_URL_RE = /^data:image\/(png|jpeg|jpg);base64,(.+)$/;

async function embedDataUrl(doc: PDFDocument, dataUrl: string, cache: Map<string, PDFImage | null>) {
  if (cache.has(dataUrl)) return cache.get(dataUrl) ?? null;
  const m = DATA_URL_RE.exec(dataUrl);
  let img: PDFImage | null = null;
  if (m) {
    try {
      const bytes = Buffer.from(m[2], "base64");
      const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
      img = isPng ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    } catch (e) {
      console.error("[finalize] image could not be embedded:", (e as Error).message);
    }
  }
  cache.set(dataUrl, img);
  return img;
}

function baseFontSize(f: Pick<StampField, "height" | "options">) {
  return f.options?.fontSize ?? Math.min(12, Math.max(8, f.height * 0.75));
}

function drawCheck(page: PDFPage, g: PageGeo, f: StampField) {
  const s = Math.min(f.width, f.height);
  const ox = f.x + (f.width - s) / 2;
  const oy = f.y + (f.height - s) / 2;
  const pts = [
    [0.2, 0.53],
    [0.42, 0.74],
    [0.8, 0.28],
  ].map(([px, py]) => toPdf(g, ox + px * s, oy + py * s));
  const thickness = Math.max(0.8, s * 0.12);
  page.drawLine({ start: pts[0], end: pts[1], thickness, color: CHECK, lineCap: LineCapStyle.Round });
  page.drawLine({ start: pts[1], end: pts[2], thickness, color: CHECK, lineCap: LineCapStyle.Round });
}

function drawSingleLine(page: PDFPage, g: PageGeo, f: StampField, text: string, font: PDFFont) {
  const value = clean(text).replace(/\n/g, " ");
  let size = baseFontSize(f);
  const avail = Math.max(1, f.width - 3);
  const width = textWidth(font, value, size);
  if (width > avail) size = Math.max(3.5, (size * avail) / width);
  drawTextAt(page, g, value, f.x + 1.5, f.y + f.height / 2 + size * 0.35, size, font);
}

function drawParagraph(page: PDFPage, g: PageGeo, f: StampField, text: string, font: PDFFont) {
  let size = baseFontSize(f);
  let lines = wrapText(text, font, size, Math.max(1, f.width - 4));
  while (lines.length * size * 1.25 > f.height - 2 && size > 4) {
    size *= 0.9;
    lines = wrapText(text, font, size, Math.max(1, f.width - 4));
  }
  lines.forEach((line, i) => drawTextAt(page, g, line, f.x + 2, f.y + 2 + size * (0.95 + i * 1.25), size, font));
}

async function drawFields(doc: PDFDocument, fonts: Fonts, fields: StampField[]) {
  const pages = doc.getPages();
  const cache = new Map<string, PDFImage | null>();
  for (const f of fields) {
    const v = f.value;
    if (!v) continue;
    const page = pages[f.page - 1];
    if (!page) continue;
    const g = pageGeo(page);
    try {
      switch (f.type) {
        case "signature":
        case "image": {
          const img = await embedDataUrl(doc, v, cache);
          if (!img) break;
          const s = Math.min(f.width / img.width, f.height / img.height);
          const dw = img.width * s;
          const dh = img.height * s;
          const dx = f.x + (f.width - dw) / 2;
          const dy = f.y + (f.height - dh) / 2;
          const p = toPdf(g, dx, dy + dh);
          page.drawImage(img, { x: p.x, y: p.y, width: dw, height: dh, rotate: degrees(g.rot) });
          break;
        }
        case "checkbox":
          if (v === "true") drawCheck(page, g, f);
          break;
        case "transcribe":
          drawParagraph(page, g, f, v, fonts.regular);
          break;
        default:
          drawSingleLine(page, g, f, v, fonts.regular);
      }
    } catch (e) {
      console.error(`[finalize] field on page ${f.page} could not be drawn:`, (e as Error).message);
    }
  }
}

/** "OpenSign Document ID : {id} - p / n" at the bottom-left of every original page */
function drawDocumentFooters(doc: PDFDocument, fonts: Fonts, documentId: string, count: number) {
  const pages = doc.getPages().slice(0, count);
  pages.forEach((page, i) => {
    const g = pageGeo(page);
    const size = Math.max(4.5, g.W * 0.0086);
    drawTextAt(page, g, `OpenSign Document ID : ${documentId} - ${i + 1} / ${count}`, g.W * 0.025, g.H * 0.985 - size * 0.3, size, fonts.regular);
  });
}

/* ------------------------------------------------------------ audit trail */

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 48;

/** 2026-10-14 12:51:41 (Korea time) */
export function fmtSeoulSeconds(iso: string | null | undefined) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(d);
}

export interface AuditData {
  doc: Pick<DocumentRow, "id" | "title" | "request_type" | "signing_order" | "requested_at" | "completed_at" | "page_count">;
  requester: { name: string; email: string } | null;
  participants: Pick<Participant, "id" | "order_index" | "name" | "email" | "status" | "signed_at" | "viewed_at" | "delivery">[];
  events: Pick<DocumentEvent, "type" | "actor_name" | "actor_email" | "ip" | "meta" | "created_at">[];
  /** SHA-256 of the original PDF */
  originalHash: string;
  /** SHA-256 of the completed PDF (only in the separate certificate) */
  completedHash?: string | null;
}

class AuditWriter {
  private page!: PDFPage;
  private y = 0;
  readonly pages: PDFPage[] = [];
  private readonly width = A4[0] - MARGIN * 2;

  constructor(
    private readonly doc: PDFDocument,
    private readonly fonts: Fonts,
  ) {
    this.addPage(true);
  }

  private addPage(first = false) {
    this.page = this.doc.addPage(A4);
    this.pages.push(this.page);
    this.page.drawRectangle({ x: 0, y: A4[1] - 6, width: A4[0], height: 6, color: NAVY });
    this.y = first ? 46 : 52;
  }

  /** PDF y of a top-based coordinate */
  private py(top: number) {
    return A4[1] - top;
  }

  ensure(height: number) {
    if (this.y + height > A4[1] - 62) this.addPage();
  }

  gap(h: number) {
    this.y += h;
  }

  text(text: string, x: number, size: number, opts: { bold?: boolean; color?: RGB; top?: number } = {}) {
    const font = opts.bold ? this.fonts.bold : this.fonts.regular;
    this.page.drawText(clean(text), { x, y: this.py((opts.top ?? this.y) + size), size, font, color: opts.color ?? INK });
  }

  rule(color: RGB = LIGHT, thickness = 0.6) {
    this.page.drawLine({ start: { x: MARGIN, y: this.py(this.y) }, end: { x: A4[0] - MARGIN, y: this.py(this.y) }, thickness, color });
  }

  header(title: string, intro: string) {
    this.text("OpenSign", MARGIN, 9, { color: GREY });
    this.gap(18);
    this.text(title, MARGIN, 22, { bold: true });
    const sub = "Audit Trail Certificate";
    const subSize = 10;
    this.text(sub, A4[0] - MARGIN - textWidth(this.fonts.regular, sub, subSize), subSize, { color: GREY, top: this.y + 10 });
    this.gap(34);
    this.rule(NAVY, 1.2);
    this.gap(12);
    for (const line of wrapText(intro, this.fonts.regular, 9, this.width)) {
      this.text(line, MARGIN, 9, { color: GREY });
      this.gap(14);
    }
  }

  section(title: string) {
    this.ensure(60);
    this.gap(16);
    this.text(title, MARGIN, 12, { bold: true });
    this.gap(22);
    this.rule(INK, 0.8);
  }

  /** label | value rows */
  rows(rows: [string, string][]) {
    const labelW = 128;
    const size = 9;
    const lh = 13;
    for (const [label, value] of rows) {
      const lines = wrapText(value || "-", this.fonts.regular, size, this.width - labelW - 8);
      const h = lines.length * lh + 12;
      this.ensure(h);
      this.text(label, MARGIN + 4, size, { bold: true, color: GREY, top: this.y + 6 });
      lines.forEach((l, i) => this.text(l, MARGIN + labelW, size, { top: this.y + 6 + i * lh }));
      this.gap(h);
      this.rule();
    }
  }

  /** simple table with wrapped cells */
  table(columns: { label: string; width: number }[], data: string[][], size = 8.5) {
    const lh = size + 4;
    const drawHead = () => {
      this.ensure(24);
      this.page.drawRectangle({ x: MARGIN, y: this.py(this.y + 20), width: this.width, height: 20, color: HEAD_BG });
      let x = MARGIN;
      for (const c of columns) {
        this.text(c.label, x + 4, size, { bold: true, color: GREY, top: this.y + 5.5 });
        x += c.width;
      }
      this.gap(20);
      this.rule();
    };
    drawHead();
    for (const row of data) {
      const cells = row.map((cell, i) => wrapText(cell || "-", this.fonts.regular, size, columns[i].width - 8));
      const h = Math.max(...cells.map((c) => c.length)) * lh + 10;
      if (this.y + h > A4[1] - 62) {
        this.addPage();
        drawHead();
      }
      let x = MARGIN;
      cells.forEach((lines, i) => {
        lines.forEach((l, j) => this.text(l, x + 4, size, { top: this.y + 5 + j * lh }));
        x += columns[i].width;
      });
      this.gap(h);
      this.rule();
    }
  }

  footers(documentId: string) {
    const n = this.pages.length;
    this.pages.forEach((page, i) => {
      const size = 7.5;
      const left = `OpenSign이 자동 생성한 감사 추적 인증서 · Document ID : ${documentId}`;
      page.drawText(left, { x: MARGIN, y: 30, size, font: this.fonts.regular, color: GREY });
      const right = `${i + 1} / ${n}`;
      page.drawText(right, { x: A4[0] - MARGIN - textWidth(this.fonts.regular, right, size), y: 30, size, font: this.fonts.regular, color: GREY });
    });
  }
}

function eventFor(p: AuditData["participants"][number], events: AuditData["events"], types: string[]) {
  const email = p.email?.toLowerCase() ?? null;
  return [...events]
    .reverse()
    .find(
      (e) =>
        types.includes(e.type) &&
        (e.meta?.participant_id === p.id || (!!email && (e.actor_email ?? "").toLowerCase() === email && !e.meta?.auto)),
    );
}

function deliveryLabel(d: Participant["delivery"]) {
  return d === "in_person" ? "직접 대면" : d === "kakao" ? "카카오톡" : "이메일";
}

/** draws the certificate pages into `doc` */
function drawAudit(doc: PDFDocument, fonts: Fonts, data: AuditData) {
  const w = new AuditWriter(doc, fonts);
  const view = data.doc.request_type === "view";
  const verb = view ? "열람" : "서명";
  w.header(
    "감사 추적 인증서",
    `이 인증서는 전자${verb} 과정에서 기록된 문서 정보, 참여자 정보와 진행 이력을 증명합니다. 모든 시각은 한국 표준시(KST, UTC+9) 기준입니다.`,
  );

  w.section("문서 정보");
  const rows: [string, string][] = [
    ["문서 제목", data.doc.title],
    ["문서 ID", data.doc.id],
    [`${verb} 요청자`, data.requester ? `${data.requester.name} (${data.requester.email})` : "-"],
    ["진행 방식", `${view ? "열람 요청" : "서명 요청"} · ${data.doc.signing_order === "sequential" ? "순서대로" : "순서없이"}`],
    ["요청 일시", fmtSeoulSeconds(data.doc.requested_at)],
    ["완료 일시", fmtSeoulSeconds(data.doc.completed_at)],
    ["페이지 수", `${data.doc.page_count} 페이지 (인증서 제외)`],
    ["원본 문서 해시 (SHA-256)", data.originalHash],
  ];
  if (data.completedHash) rows.push(["원본 검증키 (SHA-256)", `${data.completedHash}  ※ 완료 문서 파일의 SHA-256 값으로, 위·변조 여부를 확인할 때 사용합니다.`]);
  w.rows(rows);

  w.section(view ? "열람자" : "서명자");
  w.table(
    [
      { label: "순서", width: 30 },
      { label: "이름", width: 82 },
      { label: "이메일 / 전송 수단", width: 140 },
      { label: "상태", width: 56 },
      { label: `${verb} 일시`, width: 98 },
      { label: "IP", width: 93 },
    ],
    data.participants.map((p, i) => {
      const ev = eventFor(p, data.events, view ? ["viewed"] : ["signed"]);
      const when = view ? (p.status === "viewed" || p.status === "signed" ? p.viewed_at ?? p.signed_at : null) : p.signed_at;
      return [
        String(i + 1),
        p.name || "-",
        `${p.email ?? "-"}\n${deliveryLabel(p.delivery)}`,
        participantStatusLabel(p.status, data.doc.request_type),
        fmtSeoulSeconds(when),
        ev?.ip ?? "-",
      ];
    }),
  );

  w.section("진행 이력");
  w.table(
    [
      { label: "일시", width: 98 },
      { label: "내용", width: 308 },
      { label: "IP", width: 93 },
    ],
    data.events.map((e) => [
      fmtSeoulSeconds(e.created_at),
      describeEvent({ type: e.type, actor_name: e.actor_name, actor_email: e.actor_email, meta: e.meta ?? {} }),
      e.meta?.auto ? "자동 진행" : (e.ip ?? "-"),
    ]),
  );

  w.footers(data.doc.id);
}

/* ------------------------------------------------------------- data loading */

interface LoadedDocument {
  doc: DocumentRow;
  participants: Participant[];
  fields: StampField[];
  submitted: StampField[];
  events: DocumentEvent[];
  owner: Pick<Profile, "name" | "email"> | null;
  original: Uint8Array;
}

async function loadDocument(documentId: string): Promise<LoadedDocument> {
  const admin = createAdminClient();
  const { data: doc } = await admin.from("documents").select("*").eq("id", documentId).maybeSingle();
  if (!doc) throw new Error("문서를 찾을 수 없습니다.");
  const d = doc as DocumentRow;
  if (!d.file_path) throw new Error("원본 문서 파일이 없습니다.");
  const [{ data: parts }, { data: fields }, { data: events }, { data: owner }, original] = await Promise.all([
    admin.from("participants").select("*").eq("document_id", documentId).order("order_index"),
    admin.from("fields").select("type, page, x, y, width, height, options, value, filled_at").eq("document_id", documentId).order("created_at"),
    admin.from("document_events").select("*").eq("document_id", documentId).order("created_at", { ascending: true }),
    admin.from("profiles").select("name, email").eq("id", d.owner_id).maybeSingle(),
    downloadBytes(d.file_path),
  ]);
  if (!original) throw new Error("원본 문서 파일을 불러오지 못했습니다.");
  const all = ((fields ?? []) as (StampField & { filled_at: string | null })[]).map((f) => ({ ...f, options: f.options ?? {} }));
  return {
    doc: d,
    participants: (parts ?? []) as Participant[],
    fields: all,
    submitted: all.filter((f) => !!f.filled_at && !!f.value),
    events: (events ?? []) as DocumentEvent[],
    owner: (owner ?? null) as LoadedDocument["owner"],
    original,
  };
}

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

function auditData(l: LoadedDocument, originalHash: string, completedHash?: string): AuditData {
  return {
    doc: l.doc,
    requester: l.owner ? { name: l.owner.name, email: l.owner.email } : null,
    participants: l.participants,
    events: l.events,
    originalHash,
    completedHash: completedHash ?? null,
  };
}

/** original pages + submitted values + Document ID footers (+ optional appended certificate) */
async function renderDocument(l: LoadedDocument, opts: { appendAudit: boolean }) {
  const pdf = await PDFDocument.load(l.original, { ignoreEncryption: true, updateMetadata: false });
  const fonts = await embedFonts(pdf, { bold: opts.appendAudit });
  const pageCount = pdf.getPageCount();
  await drawFields(pdf, fonts, l.submitted);
  drawDocumentFooters(pdf, fonts, l.doc.id, pageCount);
  const originalHash = sha256(l.original);
  if (opts.appendAudit) drawAudit(pdf, fonts, auditData(l, originalHash));
  pdf.setTitle(l.doc.title);
  pdf.setProducer("OpenSign");
  pdf.setCreator("OpenSign");
  pdf.setModificationDate(new Date());
  return { bytes: await pdf.save(), originalHash };
}

/* ---------------------------------------------------------------- exports */

export const auditPath = (wid: string, did: string) => `${wid}/documents/${did}/audit.pdf`;

export interface FinalizeResult {
  /** completed PDF (pages with values + appended 감사 추적 인증서) */
  completedBytes: Uint8Array;
  /** separate 감사 추적 인증서 PDF */
  auditBytes: Uint8Array;
  /** SHA-256 hex of `completedBytes` (documents.completed_hash) */
  hash: string;
  completedPath: string;
  auditPath: string;
}

/**
 * Builds the completed PDF and the separate audit certificate of a document whose signers have
 * all signed, uploads both (paths.documentCompleted / audit.pdf) and stores
 * documents.completed_file_path, completed_hash and audit_file_path. Throws on failure.
 * Server-only; callers must have authorised the request.
 */
export async function finalizeDocument(documentId: string): Promise<FinalizeResult> {
  const l = await loadDocument(documentId);
  const { bytes: completedBytes, originalHash } = await renderDocument(l, { appendAudit: true });
  const hash = sha256(completedBytes);

  const certificate = await PDFDocument.create();
  const certFonts = await embedFonts(certificate);
  drawAudit(certificate, certFonts, auditData(l, originalHash, hash));
  certificate.setTitle(`감사 추적 인증서 - ${l.doc.title}`);
  certificate.setProducer("OpenSign");
  certificate.setCreator("OpenSign");
  const auditBytes = await certificate.save();

  const completedPath = paths.documentCompleted(l.doc.workspace_id, l.doc.id);
  const certPath = auditPath(l.doc.workspace_id, l.doc.id);
  await uploadBytes(completedPath, completedBytes);
  await uploadBytes(certPath, auditBytes);

  const { error } = await createAdminClient()
    .from("documents")
    .update({ completed_file_path: completedPath, completed_hash: hash, audit_file_path: certPath })
    .eq("id", l.doc.id);
  if (error) throw new Error(error.message);

  return { completedBytes, auditBytes, hash, completedPath, auditPath: certPath };
}

/**
 * On-the-fly PDF of a document that is still in progress: the original pages with every value
 * submitted so far and the Document ID footer (no certificate). Server-only; authorise first.
 */
export async function buildPreviewPdf(documentId: string): Promise<Uint8Array> {
  const l = await loadDocument(documentId);
  const { bytes } = await renderDocument(l, { appendAudit: false });
  return bytes;
}
