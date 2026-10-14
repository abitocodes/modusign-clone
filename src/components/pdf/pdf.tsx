"use client";

import type { PDFDocumentProxy } from "pdfjs-dist";
import { useEffect, useRef, useState, type ReactNode } from "react";

import type { PageSize } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * pdf.js helpers (client only).
 *
 * Coordinates convention used across the app: field positions are stored in PDF
 * points relative to the TOP-LEFT of the page (x → right, y → down), unrotated.
 * On screen, multiply by `scale` (= displayed page width / page width in points).
 */

type PdfJs = typeof import("pdfjs-dist");
let pdfjsPromise: Promise<PdfJs> | null = null;

export function loadPdfJs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist").then((m) => {
      m.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      return m;
    });
  }
  return pdfjsPromise;
}

export type PdfSource = string | ArrayBuffer | Uint8Array | null | undefined;

/** Read page count and page sizes (in PDF points) of a local File/ArrayBuffer. */
export async function readPdfInfo(data: ArrayBuffer): Promise<{ pageCount: number; pageSizes: PageSize[] }> {
  const pdfjs = await loadPdfJs();
  const task = pdfjs.getDocument({ data: new Uint8Array(data.slice(0)) });
  const doc = await task.promise;
  const pageSizes: PageSize[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    pageSizes.push({ w: vp.width, h: vp.height });
  }
  const pageCount = doc.numPages;
  await task.destroy();
  return { pageCount, pageSizes };
}

/** Render the first page of a PDF to a PNG data URL (used for thumbnails of uploads/templates). */
export async function renderPdfThumbnail(data: ArrayBuffer, width = 240): Promise<string> {
  const pdfjs = await loadPdfJs();
  const task = pdfjs.getDocument({ data: new Uint8Array(data.slice(0)) });
  const doc = await task.promise;
  const page = await doc.getPage(1);
  const vp1 = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale: width / vp1.width });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(vp.width);
  canvas.height = Math.ceil(vp.height);
  await page.render({ canvas, viewport: vp }).promise;
  const url = canvas.toDataURL("image/png");
  await task.destroy();
  return url;
}

/** Load a PDF document from a URL / bytes. Returns the proxy + page sizes. */
export function usePdfDocument(src: PdfSource) {
  // the loaded result remembers which `src` it belongs to; loading is derived from that
  const [result, setResult] = useState<{
    src: PdfSource;
    doc: PDFDocumentProxy | null;
    pageSizes: PageSize[];
    error: string | null;
  } | null>(null);

  useEffect(() => {
    if (!src) return;
    let cancelled = false;
    let loadingTask: { destroy: () => Promise<void> } | null = null;
    (async () => {
      try {
        const pdfjs = await loadPdfJs();
        const params =
          typeof src === "string"
            ? { url: src }
            : { data: src instanceof Uint8Array ? src.slice(0) : new Uint8Array(src.slice(0)) };
        const task = pdfjs.getDocument(params);
        loadingTask = task;
        const doc = await task.promise;
        const sizes: PageSize[] = [];
        for (let i = 1; i <= doc.numPages; i++) {
          const p = await doc.getPage(i);
          const vp = p.getViewport({ scale: 1 });
          sizes.push({ w: vp.width, h: vp.height });
        }
        if (!cancelled) setResult({ src, doc, pageSizes: sizes, error: null });
      } catch (e) {
        if (!cancelled) setResult({ src, doc: null, pageSizes: [], error: (e as Error).message ?? "PDF를 불러오지 못했습니다." });
      }
    })();
    return () => {
      cancelled = true;
      void loadingTask?.destroy();
    };
  }, [src]);

  const current = src && result && result.src === src ? result : null;
  return {
    doc: current?.doc ?? null,
    pageSizes: current?.pageSizes ?? [],
    error: current?.error ?? null,
    loading: !!src && !current,
  };
}

/**
 * One rendered page. `width` is the on-screen width in CSS px; children are rendered in an
 * absolutely positioned overlay of the same size (use `scale` = width / pageWidthPts to place fields).
 */
export function PdfPageView({
  doc,
  pageNumber,
  width,
  className,
  children,
  onClick,
  overlayRef,
  footer,
}: {
  doc: PDFDocumentProxy | null;
  pageNumber: number;
  width: number;
  className?: string;
  children?: ReactNode;
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
  overlayRef?: React.Ref<HTMLDivElement>;
  /** small text stamped at the bottom-left of the page (Document ID …) */
  footer?: ReactNode;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    let task: { cancel: () => void; promise: Promise<void> } | null = null;
    (async () => {
      const page = await doc.getPage(pageNumber);
      if (cancelled) return;
      const vp1 = page.getViewport({ scale: 1 });
      const scale = width / vp1.width;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const vp = page.getViewport({ scale: scale * dpr });
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = Math.ceil(vp.width);
      canvas.height = Math.ceil(vp.height);
      setSize({ w: width, h: vp1.height * scale });
      task = page.render({ canvas, viewport: vp });
      try {
        await task.promise;
      } catch {
        /* cancelled */
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, pageNumber, width]);

  return (
    <div
      className={cn("relative bg-page shadow-card", className)}
      style={{ width, height: size?.h ?? width * 1.414 }}
      onClick={onClick}
    >
      <canvas ref={canvasRef} className="absolute inset-0 size-full" />
      {footer && <div className="pointer-events-none absolute bottom-[1.5%] left-[2.5%] text-[7px] text-[#292929]">{footer}</div>}
      <div ref={overlayRef} className="absolute inset-0">
        {children}
      </div>
    </div>
  );
}

/** Small page thumbnail (used in the editor's right panel and the signer's left rail). */
export function PdfThumbnail({
  doc,
  pageNumber,
  width = 90,
  active,
  onClick,
  label,
}: {
  doc: PDFDocumentProxy | null;
  pageNumber: number;
  width?: number;
  active?: boolean;
  onClick?: () => void;
  label?: ReactNode;
}) {
  return (
    <button type="button" onClick={onClick} className="relative block shrink-0 rounded-[3px]">
      <PdfPageView doc={doc} pageNumber={pageNumber} width={width} className="rounded-[3px] shadow-none" />
      <span
        className={cn(
          "pointer-events-none absolute inset-0 rounded-[3px] border-[3px]",
          active ? "border-[#ffb600]" : "border-transparent",
        )}
      />
      {label}
    </button>
  );
}
