import type { PDFFont, PDFPage } from "pdf-lib";

import { PDF_FONT_FEATURES, baselineOffset, hexToRgb01, wrapPlainText } from "../../_edit-kit/text-layout";
import { TEXT_LINE_HEIGHT, type Annotation } from "../annotations";

/** Check-mark path in a 24×24 box (y down). */
export const CHECK_PATH = "M4.5 12.5 L9.75 17.75 L19.5 6.5";
export const CHECK_STROKE = 3;

/** Builds the SVG path of a freehand stroke in box coordinates (points). */
export function strokePath(points: number[], width: number, height: number) {
  let d = "";
  for (let i = 0; i + 1 < points.length; i += 2) {
    d += `${i === 0 ? "M" : " L"}${(points[i] * width).toFixed(2)} ${(points[i + 1] * height).toFixed(2)}`;
  }
  return d;
}

/**
 * Burns the annotations into a copy of the PDF (pdf-lib + fontkit, Pretendard TTF).
 * Annotation coordinates are top-left based in the displayed page space (rotation + CropBox
 * applied, like pdf.js `getViewport({ scale: 1 })`); a CTM maps them onto each page.
 */
export async function flattenAnnotations(
  source: Uint8Array,
  annotations: Annotation[],
  loadFont: () => Promise<ArrayBuffer>,
): Promise<Uint8Array> {
  const lib = await import("pdf-lib");
  const { PDFDocument, rgb, LineCapStyle, LineJoinStyle, pushGraphicsState, popGraphicsState, concatTransformationMatrix, setLineJoin } = lib;

  const pdf = await PDFDocument.load(source.slice(0), { updateMetadata: false });
  let font: PDFFont | null = null;
  if (annotations.some((a) => a.type === "text")) {
    const fontkit = (await import("@pdf-lib/fontkit")).default;
    pdf.registerFontkit(fontkit);
    font = await pdf.embedFont(await loadFont(), { subset: false, features: PDF_FONT_FEATURES });
  }

  const pages = pdf.getPages();
  const byPage = new Map<number, Annotation[]>();
  for (const a of annotations) {
    if (a.page < 1 || a.page > pages.length) continue;
    byPage.set(a.page, [...(byPage.get(a.page) ?? []), a]);
  }

  for (const [pageNo, list] of byPage) {
    const page: PDFPage = pages[pageNo - 1];
    const box = page.getCropBox();
    const rot = (((page.getRotation().angle % 360) + 360) % 360) as 0 | 90 | 180 | 270;
    const turned = rot === 90 || rot === 270;
    const dispH = turned ? box.width : box.height;

    // display space (x right, y up from the displayed bottom-left) → PDF user space
    const m: [number, number, number, number, number, number] =
      rot === 90
        ? [0, 1, -1, 0, box.x + box.width, box.y]
        : rot === 180
          ? [-1, 0, 0, -1, box.x + box.width, box.y + box.height]
          : rot === 270
            ? [0, -1, 1, 0, box.x, box.y + box.height]
            : [1, 0, 0, 1, box.x, box.y];

    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...m), setLineJoin(LineJoinStyle.Round));

    // white-outs first so that text / marks placed on top stay visible
    const ordered = [...list.filter((a) => a.type === "whiteout"), ...list.filter((a) => a.type !== "whiteout")];
    for (const a of ordered) {
      const top = dispH - a.y;
      switch (a.type) {
        case "whiteout":
          page.drawRectangle({ x: a.x, y: top - a.height, width: a.width, height: a.height, color: rgb(1, 1, 1) });
          break;
        case "check": {
          const [r, g, b] = hexToRgb01(a.color);
          const size = Math.min(a.width, a.height);
          page.drawSvgPath(CHECK_PATH, {
            x: a.x + (a.width - size) / 2,
            y: top - (a.height - size) / 2,
            scale: size / 24,
            borderColor: rgb(r, g, b),
            borderWidth: CHECK_STROKE,
            borderLineCap: LineCapStyle.Round,
          });
          break;
        }
        case "draw": {
          const [r, g, b] = hexToRgb01(a.color);
          page.drawSvgPath(strokePath(a.points, a.width, a.height), {
            x: a.x,
            y: top,
            borderColor: rgb(r, g, b),
            borderWidth: a.strokeWidth,
            borderLineCap: LineCapStyle.Round,
          });
          break;
        }
        case "text": {
          if (!font) break;
          const f = font;
          const [r, g, b] = hexToRgb01(a.color);
          const size = a.fontSize;
          const lh = size * TEXT_LINE_HEIGHT;
          const lines = wrapPlainText(sanitizeForFont(a.text), a.width, (s) => f.widthOfTextAtSize(s, size));
          const base = baselineOffset(size, lh);
          lines.forEach((line, i) => {
            if (!line) return;
            page.drawText(line, { x: a.x, y: top - (i * lh + base), size, font: f, color: rgb(r, g, b) });
          });
          break;
        }
      }
    }
    page.pushOperators(popGraphicsState());
  }

  return pdf.save();
}

/** Replaces characters pdf-lib cannot encode (control chars) with spaces. */
export function sanitizeForFont(s: string) {
  return s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").replace(/ /g, " ");
}
