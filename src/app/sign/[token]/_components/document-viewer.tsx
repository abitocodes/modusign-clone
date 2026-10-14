"use client";

import { ChevronLeft, LoaderCircle, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { PdfPageView, PdfThumbnail, usePdfDocument } from "@/components/pdf/pdf";
import type { PageSize } from "@/lib/types";

import type { SignDone } from "../_lib/types";
import { SignTopBar, ZoomButtons } from "./chrome";
import { FilledFieldView } from "./signer-field";

/** px per PDF point at 100 % (A4 595pt → 816px, "137%") */
export const BASE_SCALE = 816 / 595;
const ZOOMS = [0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2] as const;

export function useZoom() {
  const [idx, setIdx] = useState<number>(ZOOMS.indexOf(1));
  return {
    zoom: ZOOMS[idx],
    canZoomIn: idx < ZOOMS.length - 1,
    canZoomOut: idx > 0,
    zoomIn: () => setIdx((i) => Math.min(ZOOMS.length - 1, i + 1)),
    zoomOut: () => setIdx((i) => Math.max(0, i - 1)),
  };
}

export function ZoomControls({ z }: { z: ReturnType<typeof useZoom> }) {
  return (
    <ZoomButtons
      onZoomIn={z.zoomIn}
      onZoomOut={z.zoomOut}
      canZoomIn={z.canZoomIn}
      canZoomOut={z.canZoomOut}
      percent={Math.round(z.zoom * 100)}
    />
  );
}

export interface PageOverlay {
  page: number;
  /** CSS px per PDF point */
  scale: number;
  /** free horizontal space left of the page (for the 다음 guide tab) */
  gutter: number;
}

/**
 * Thumbnail rail (w114) + centred scrollable pages (816px at 100 %) with a per-page overlay.
 * Pages use the stored sizes until pdf.js has loaded the real ones.
 */
export function DocumentPane({
  pdfUrl,
  pageSizes,
  documentId,
  zoom,
  renderOverlay,
  banner,
}: {
  pdfUrl: string;
  pageSizes: PageSize[];
  documentId: string;
  zoom: number;
  renderOverlay?: (o: PageOverlay) => ReactNode;
  banner?: ReactNode;
}) {
  const pdf = usePdfDocument(pdfUrl);
  const sizes = pdf.pageSizes.length ? pdf.pageSizes : pageSizes;
  const scrollerRef = useRef<HTMLDivElement>(null);
  const frame = useRef<number | null>(null);
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState(1);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  const onScroll = useCallback(() => {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const el = scrollerRef.current;
      if (!el) return;
      const line = el.scrollTop + el.clientHeight * 0.35;
      let current = 1;
      el.querySelectorAll<HTMLElement>("[data-page]").forEach((p) => {
        if (p.offsetTop <= line) current = Number(p.dataset.page);
      });
      setActive(current);
    });
  }, []);

  const scrollToPage = (page: number) => {
    scrollerRef.current?.querySelector(`[data-page="${page}"]`)?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  const pad = width >= 640 ? 110 : 16;
  const maxW = Math.max(1, ...sizes.map((s) => s.w));
  const fit = width > 0 ? Math.min(1, Math.max(0.2, (width - pad * 2) / (maxW * BASE_SCALE))) : 1;
  const scale = BASE_SCALE * zoom * fit;

  return (
    <div className="flex min-h-0 flex-1">
      <nav aria-label="페이지 목록" className="hidden w-[114px] shrink-0 overflow-y-auto border-r border-line bg-surface p-3 md:block">
        <ol className="flex flex-col items-center gap-3">
          {sizes.map((_, i) => (
            <li key={i}>
              <PdfThumbnail
                doc={pdf.doc}
                pageNumber={i + 1}
                width={90}
                active={active === i + 1}
                onClick={() => scrollToPage(i + 1)}
                label={
                  <span className="pointer-events-none absolute left-1 top-0.5 text-xl font-bold leading-none text-[#292929]">{i + 1}</span>
                }
              />
            </li>
          ))}
        </ol>
      </nav>

      <div ref={scrollerRef} onScroll={onScroll} data-sign-scroller="" className="relative min-w-0 flex-1 overflow-auto bg-body-2">
        {pdf.error ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <TriangleAlert className="size-7 text-negative" />
            <p className="text-sm text-fg-2">문서를 불러오지 못했습니다.</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="h-9 rounded bg-btn-dark px-4 text-sm font-medium text-fg-2 hover:bg-btn-hover"
            >
              다시 시도
            </button>
          </div>
        ) : sizes.length === 0 ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-fg-muted" role="status">
            <LoaderCircle className="size-5 animate-spin" /> 문서를 불러오는 중…
          </div>
        ) : (
          <div className="flex w-max min-w-full flex-col items-center gap-6 py-[30px]" style={{ paddingLeft: pad, paddingRight: pad }}>
            {banner}
            {sizes.map((s, i) => {
              const page = i + 1;
              const w = s.w * scale;
              const h = s.h * scale;
              const gutter = Math.max(pad, (width - w) / 2);
              return (
                <div key={page} data-page={page} className="relative shrink-0 scroll-mt-6" style={{ width: w, height: h }}>
                  <PdfPageView
                    doc={pdf.doc}
                    pageNumber={page}
                    width={w}
                    className="!h-full"
                    footer={`OpenSign Document ID : ${documentId} - ${page} / ${sizes.length}`}
                  >
                    {renderOverlay?.({ page, scale, gutter })}
                  </PdfPageView>
                  {!pdf.doc && (
                    <span className="pointer-events-none absolute inset-x-0 top-6 flex justify-center text-[#9e9e9e]" aria-hidden>
                      <LoaderCircle className="size-5 animate-spin" />
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/** Read-only document (내 서명 완료 → 문서 미리보기): every submitted value, no inputs. */
export function ReadOnlyViewer({ done, onClose }: { done: SignDone; onClose: () => void }) {
  const z = useZoom();
  const preview = done.preview!;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector('[role="dialog"]')) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-body-2">
      <SignTopBar tall menu={done.menu} after={<ZoomControls z={z} />} />
      <DocumentPane
        pdfUrl={preview.pdfUrl}
        pageSizes={preview.pageSizes}
        documentId={done.documentId}
        zoom={z.zoom}
        renderOverlay={({ page, scale }) =>
          preview.fields.filter((f) => f.page === page).map((f) => <FilledFieldView key={f.id} f={f} scale={scale} />)
        }
      />
      <footer className="flex h-[74px] shrink-0 items-center justify-center border-t border-line bg-surface px-4">
        <button
          type="button"
          onClick={onClose}
          className="flex h-12 w-full max-w-[180px] items-center justify-center gap-1 rounded-md bg-btn-light text-base font-medium text-fg-2 shadow-button hover:bg-btn-base"
        >
          <ChevronLeft className="size-4" />
          돌아가기
        </button>
      </footer>
    </div>
  );
}
