"use client";

import { createClient } from "@/lib/supabase/client";
import { BUCKET } from "@/lib/storage";

/**
 * Browser helpers shared by the 문서 편집기 / 서식 작성기 editors.
 */

/** RFC 4122 v4 id (falls back to getRandomValues where randomUUID is unavailable, e.g. plain-http intranet hosts). */
export function newId(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === "function") return c.randomUUID();
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Uploads a PDF with the user's session (storage RLS = workspace membership). Returns an error message or null. */
export async function uploadPdf(path: string, data: Blob | Uint8Array): Promise<string | null> {
  const body = data instanceof Blob ? data : new Blob([data as BlobPart], { type: "application/pdf" });
  const { error } = await createClient().storage.from(BUCKET).upload(path, body, {
    contentType: "application/pdf",
    upsert: false,
  });
  return error ? error.message || "파일을 업로드하지 못했습니다." : null;
}

/** Downloads an object of the documents bucket with the user's session. */
export async function downloadPdf(path: string): Promise<Uint8Array> {
  const { data, error } = await createClient().storage.from(BUCKET).download(path);
  if (error || !data) throw new Error(error?.message || "파일을 불러오지 못했습니다.");
  return new Uint8Array(await data.arrayBuffer());
}

/**
 * Pretendard for pdf-lib. The TrueType build is used because @pdf-lib/fontkit cannot decode
 * the CFF table of the OTF build; fonts are embedded without subsetting (subsetting drops glyphs).
 */
const FONT_URLS = { regular: "/fonts/Pretendard-Regular.ttf", bold: "/fonts/Pretendard-Bold.ttf" } as const;
const fontCache = new Map<keyof typeof FONT_URLS, Promise<ArrayBuffer>>();

export function loadFontBytes(kind: keyof typeof FONT_URLS): Promise<ArrayBuffer> {
  let p = fontCache.get(kind);
  if (!p) {
    p = fetch(FONT_URLS[kind]).then((r) => {
      if (!r.ok) throw new Error("글꼴을 불러오지 못했습니다.");
      return r.arrayBuffer();
    });
    p.catch(() => fontCache.delete(kind));
    fontCache.set(kind, p);
  }
  return p;
}
