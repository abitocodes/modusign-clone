"use client";

import { ChevronLeft, ChevronRight, Pin } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { HelpLabel, PdfFirstPage, RequestTypeChip } from "@/components/templates/parts";
import { CountPill } from "@/components/ui/badge";
import { fmtDate } from "@/lib/utils";

import type { TemplateListItem } from "./templates-view";

const CARD_W = 330;
const GAP = 12;
const COLLAPSE_KEY = "templates.pinned.collapsed";
const COLLAPSE_EVENT = "templates-pinned-collapsed";

/** 접기 state is a per-viewer convenience kept in localStorage (the page renders fine without it). */
function subscribeCollapsed(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(COLLAPSE_EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(COLLAPSE_EVENT, cb);
  };
}

function readCollapsed() {
  try {
    return window.localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

function PinnedCard({ wid, item, onUnpin, busy }: { wid: string; item: TemplateListItem; onUnpin: () => void; busy: boolean }) {
  return (
    <div className="group relative flex h-32 shrink-0 gap-3.5 rounded-lg border border-line-light bg-surface-3 p-4 transition-colors hover:border-line-strong" style={{ width: CARD_W }}>
      <PdfFirstPage url={item.thumbUrl} width={68} className="h-24 shrink-0 rounded-sm shadow-card" />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start gap-1.5">
          <p className="line-clamp-2 min-w-0 flex-1 text-[15px] font-medium leading-snug text-fg" title={item.title}>
            {item.title}
          </p>
          <button
            type="button"
            onClick={onUnpin}
            disabled={busy}
            aria-label={`${item.title} 고정 해제`}
            title="고정 해제"
            className="-mr-1.5 -mt-1 flex size-7 shrink-0 items-center justify-center rounded text-warning hover:bg-btn-light disabled:opacity-50"
          >
            <Pin className="size-4 fill-current" />
          </button>
        </div>
        <p className="mt-1 flex items-center gap-1.5 truncate text-xs text-fg-muted">
          <RequestTypeChip type={item.requestType} className="h-[18px] px-1.5 text-[11px]" />
          <span className="truncate">참여자 {item.roleNames.length}명 · {fmtDate(item.updatedAt)} 수정</span>
        </p>
        <div className="mt-auto flex justify-end">
          <Link
            href={`/workspaces/${wid}/templates/${item.id}/use`}
            className="inline-flex h-7 items-center rounded bg-btn-dark px-2.5 text-[13px] font-medium text-fg-2 transition-colors hover:bg-btn-hover"
          >
            사용하기
          </Link>
        </div>
      </div>
    </div>
  );
}

/** 자주 쓰는 템플릿: pinned template cards with prev/next paging and a 접기 toggle. */
export function PinnedTemplates({
  wid,
  items,
  busyId,
  onUnpin,
}: {
  wid: string;
  items: TemplateListItem[];
  busyId: string | null;
  onUnpin: (item: TemplateListItem) => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [perPage, setPerPage] = useState(3);
  const [pageIndex, setPageIndex] = useState(0);
  const storedCollapsed = useSyncExternalStore(subscribeCollapsed, readCollapsed, () => false);
  const [memCollapsed, setMemCollapsed] = useState<boolean | null>(null);
  const collapsed = memCollapsed ?? storedCollapsed;

  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    // the observer also fires once right after observe() → initial measurement
    const ro = new ResizeObserver(() => setPerPage(Math.max(1, Math.floor((el.clientWidth + GAP) / (CARD_W + GAP)))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [collapsed]);

  const pageCount = Math.max(1, Math.ceil(items.length / perPage));
  const current = Math.min(pageIndex, pageCount - 1);
  const visible = items.slice(current * perPage, current * perPage + perPage);

  const toggleCollapsed = () => {
    const next = !collapsed;
    setMemCollapsed(next);
    try {
      window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      window.dispatchEvent(new Event(COLLAPSE_EVENT));
    } catch {
      // storage unavailable (private mode) — keep the in-memory state only
    }
  };

  const navBtn =
    "flex h-8 w-20 items-center justify-center rounded-[3px] bg-btn-light text-icon-2 shadow-button transition-colors hover:bg-btn-base disabled:text-fg-disabled disabled:hover:bg-btn-light";

  return (
    <section className="mt-5" aria-labelledby="pinned-templates-title">
      <div className="flex h-8 items-center justify-between">
        <h2 id="pinned-templates-title" className="flex items-center gap-2 text-base font-semibold text-fg">
          <Pin className="size-4 fill-current text-icon" strokeWidth={2} aria-hidden />
          <HelpLabel
            label="자주 쓰는 템플릿"
            tip="템플릿 목록의 고정 버튼을 누르면 자주 쓰는 템플릿으로 지정되어 이곳에 표시됩니다. 나에게만 보입니다."
            className="gap-1.5"
            iconClassName="text-fg-muted"
          />
          <CountPill className="ml-0.5">{items.length}개</CountPill>
        </h2>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={toggleCollapsed} aria-expanded={!collapsed} className="mr-4 text-[13px] text-fg-muted underline underline-offset-2 hover:text-fg-2">
            {collapsed ? "펼치기" : "접기"}
          </button>
          <button type="button" aria-label="이전 템플릿" className={navBtn} disabled={collapsed || current === 0} onClick={() => setPageIndex(current - 1)}>
            <ChevronLeft className="size-5" />
          </button>
          <button
            type="button"
            aria-label="다음 템플릿"
            className={navBtn}
            disabled={collapsed || current >= pageCount - 1}
            onClick={() => setPageIndex(current + 1)}
          >
            <ChevronRight className="size-5" />
          </button>
        </div>
      </div>

      {!collapsed && (
        <div ref={rowRef} className="mt-4 flex gap-3" aria-live="polite">
          {items.length === 0 ? (
            <div
              className="flex h-32 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line-strong bg-menu text-[13px] text-fg-faint"
              style={{ width: CARD_W }}
            >
              <Pin className="size-4 fill-current text-fg-disabled" aria-hidden />
              자주 쓰는 템플릿을 지정할 수 있어요.
            </div>
          ) : (
            visible.map((item) => <PinnedCard key={item.id} wid={wid} item={item} busy={busyId === item.id} onUnpin={() => onUnpin(item)} />)
          )}
        </div>
      )}
      {!collapsed && items.length > perPage && (
        <p className="sr-only" aria-live="polite">
          {current + 1} / {pageCount} 페이지
        </p>
      )}
    </section>
  );
}
