"use client";

import type { PDFDocumentProxy } from "pdfjs-dist";
import { useEffect, useRef, useState } from "react";

import { PdfPageView } from "@/components/pdf/pdf";
import type { PageSize } from "@/lib/types";

/** Width (px) of an element, kept in sync with ResizeObserver. */
export function useElementWidth<T extends HTMLElement>(fallback = 816) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(Math.floor(w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** One page that renders only once it scrolls near the viewport. */
function LazyPage({ doc, pageNumber, width, size }: { doc: PDFDocumentProxy; pageNumber: number; width: number; size?: PageSize }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(pageNumber <= 2);
  useEffect(() => {
    if (visible) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "800px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  const height = size ? (size.h / size.w) * width : width * 1.414;
  return (
    <div ref={ref} role="group" style={{ width, minHeight: height }} aria-label={`${pageNumber} 페이지`}>
      {visible ? <PdfPageView doc={doc} pageNumber={pageNumber} width={width} /> : <div className="animate-pulse bg-surface-4 shadow-card" style={{ width, height }} />}
      <p className="mt-2 text-center text-xs text-fg-faint">
        {pageNumber} / {doc.numPages}
      </p>
    </div>
  );
}

/** Vertical stack of all pages of a PDF (read-only viewer). */
export function PdfPages({ doc, pageSizes, width }: { doc: PDFDocumentProxy; pageSizes: PageSize[]; width: number }) {
  return (
    <div className="flex flex-col items-center gap-6">
      {Array.from({ length: doc.numPages }, (_, i) => (
        <LazyPage key={i} doc={doc} pageNumber={i + 1} width={width} size={pageSizes[i]} />
      ))}
    </div>
  );
}
