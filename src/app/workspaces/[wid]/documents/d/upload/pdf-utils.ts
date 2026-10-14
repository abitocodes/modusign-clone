import { PDFDocument } from "pdf-lib";

import { readPdfInfo, renderPdfThumbnail } from "@/components/pdf/pdf";
import { MAX_PDF_BYTES } from "@/lib/storage";
import type { PageSize } from "@/lib/types";

import { uuid } from "../_lib/types";

/** Browser-only helpers for the upload step (pdf-lib + pdf.js). */

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const A4 = { w: 595.28, h: 841.89 };
/** longest side of an embedded image (≈ A4 at 300 dpi) */
const MAX_IMAGE_SIDE = 2480;

export interface PreparedFile {
  key: string;
  /** original file name */
  name: string;
  /** file name without extension */
  title: string;
  kind: "pdf" | "image";
  /** the file as a PDF (images are converted to a 1-page PDF) */
  bytes: Uint8Array;
  pageCount: number;
  /** PNG data URL of the first page */
  thumb: string;
  size: number;
}

export class UploadError extends Error {}

export const stripExtension = (name: string) => name.replace(/\.[^./\\]+$/, "").trim() || name;

const toArrayBuffer = (bytes: Uint8Array) => bytes.slice().buffer as ArrayBuffer;

export function fileKind(file: File): "pdf" | "image" | null {
  const type = file.type.toLowerCase();
  if (type === "application/pdf" || /\.pdf$/i.test(file.name)) return "pdf";
  if (type === "image/jpeg" || type === "image/png" || /\.(jpe?g|png)$/i.test(file.name)) return "image";
  return null;
}

async function imageToPdf(file: File): Promise<Uint8Array> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file); // applies EXIF orientation
  } catch {
    throw new UploadError(`이미지를 읽을 수 없습니다: ${file.name}`);
  }
  const ratio = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * ratio));
  const h = Math.max(1, Math.round(bitmap.height * ratio));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new UploadError("이미지를 변환하지 못했습니다.");
  const png = file.type === "image/png" || /\.png$/i.test(file.name);
  if (!png) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
  }
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new UploadError("이미지를 변환하지 못했습니다."))), png ? "image/png" : "image/jpeg", 0.9),
  );
  const imageBytes = new Uint8Array(await blob.arrayBuffer());

  const pdf = await PDFDocument.create();
  const image = png ? await pdf.embedPng(imageBytes) : await pdf.embedJpg(imageBytes);
  const page = w > h ? { w: A4.h, h: A4.w } : A4;
  const fit = Math.min(page.w / w, page.h / h);
  const dw = w * fit;
  const dh = h * fit;
  const p = pdf.addPage([page.w, page.h]);
  p.drawImage(image, { x: (page.w - dw) / 2, y: (page.h - dh) / 2, width: dw, height: dh });
  pdf.setTitle(stripExtension(file.name));
  return pdf.save();
}

/** Validates a chosen file and turns it into a PDF with page count + thumbnail. */
export async function prepareFile(file: File): Promise<PreparedFile> {
  const kind = fileKind(file);
  if (!kind) throw new UploadError("PDF 또는 이미지 파일만 지원합니다");
  if (file.size === 0) throw new UploadError(`빈 파일은 업로드할 수 없습니다: ${file.name}`);
  if (kind === "pdf" && file.size > MAX_PDF_BYTES) throw new UploadError("PDF는 최대 10MB까지 업로드할 수 있습니다.");
  if (kind === "image" && file.size > MAX_IMAGE_BYTES) throw new UploadError("JPG, PNG 파일은 최대 5MB까지 업로드할 수 있습니다.");

  let bytes: Uint8Array;
  if (kind === "pdf") {
    bytes = new Uint8Array(await file.arrayBuffer());
    try {
      // the completed PDF is produced with pdf-lib, so the source must be readable by it
      await PDFDocument.load(bytes, { updateMetadata: false });
    } catch (e) {
      const encrypted = /encrypt/i.test((e as Error).message ?? "");
      throw new UploadError(encrypted ? "보안(암호)이 설정된 PDF는 업로드할 수 없습니다." : `PDF 파일을 읽을 수 없습니다: ${file.name}`);
    }
  } else {
    bytes = await imageToPdf(file);
  }

  let pageCount: number;
  let thumb: string;
  try {
    const info = await readPdfInfo(toArrayBuffer(bytes));
    pageCount = info.pageCount;
    thumb = await renderPdfThumbnail(toArrayBuffer(bytes), 380);
  } catch {
    throw new UploadError(`문서를 열 수 없습니다: ${file.name}`);
  }

  return {
    key: uuid(),
    name: file.name,
    title: stripExtension(file.name),
    kind,
    bytes,
    pageCount,
    thumb,
    size: bytes.byteLength,
  };
}

/** Merges the prepared files (in order) into one PDF. A single PDF upload is kept byte-for-byte. */
export async function mergePrepared(files: PreparedFile[]): Promise<{ bytes: Uint8Array; pageCount: number; pageSizes: PageSize[] }> {
  if (files.length === 0) throw new UploadError("업로드할 문서를 추가해 주세요.");
  let bytes: Uint8Array;
  if (files.length === 1) {
    bytes = files[0].bytes;
  } else {
    const out = await PDFDocument.create();
    for (const f of files) {
      const src = await PDFDocument.load(f.bytes);
      const pages = await out.copyPages(src, src.getPageIndices());
      pages.forEach((p) => out.addPage(p));
    }
    out.setTitle(files[0].title);
    bytes = await out.save();
  }
  if (bytes.byteLength > MAX_PDF_BYTES) throw new UploadError("합친 문서의 크기가 10MB를 넘습니다. 문서 수를 줄여 주세요.");
  const info = await readPdfInfo(toArrayBuffer(bytes));
  return { bytes, pageCount: info.pageCount, pageSizes: info.pageSizes };
}
