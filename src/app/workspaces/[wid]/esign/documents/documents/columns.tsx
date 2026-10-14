import type { Column } from "@/components/ui/list-page";

/**
 * Column geometry of the 문서함 table, shared by the header and the rows so they always line up.
 * Widths follow the captured screen (1421px viewport); on narrower screens the fixed columns shrink
 * (down to their minimum) so that 문서 제목 keeps at least 160px.
 * 상태 never shrinks: the row expand panel starts exactly at the 문서 제목 column
 * (PANEL_LEFT = row padding 12 + checkbox 16 + gap 16 + 상태 136).
 */
export const PANEL_LEFT = 180;

export const COL = {
  status: { width: 136, className: "shrink-0" },
  title: { className: "min-w-[160px]" },
  label: { width: 180, className: "shrink min-w-[110px]" },
  shared: { width: 110, className: "shrink min-w-[72px]" },
  requested: { width: 120, className: "shrink min-w-[96px]" },
  completed: { width: 120, className: "shrink min-w-[96px]" },
  activity: { width: 128, className: "shrink min-w-[96px]" },
  menu: { width: 74, className: "" },
} as const;

const nowrap = "whitespace-nowrap";

export const DOC_COLUMNS: Column[] = [
  { key: "status", label: "상태", width: COL.status.width, className: `${COL.status.className} ${nowrap}` },
  { key: "title", label: "문서 제목", sortable: true, className: `${COL.title.className} ${nowrap}` },
  { key: "label", label: "라벨", width: COL.label.width, className: `${COL.label.className} ${nowrap}` },
  {
    key: "shared",
    label: (
      <span className="flex items-center gap-1" title="문서를 요청한 사람과 공유받은 멤버">
        공유됨
        <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden>
          <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <path d="M6.3 6.2a1.8 1.8 0 1 1 2.6 1.6c-.6.3-.9.7-.9 1.3v.3" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          <circle cx="8" cy="11.4" r=".8" fill="currentColor" />
        </svg>
      </span>
    ),
    width: COL.shared.width,
    className: `${COL.shared.className} ${nowrap}`,
  },
  { key: "requested", label: "요청일", width: COL.requested.width, sortable: true, className: `${COL.requested.className} ${nowrap}` },
  { key: "completed", label: "체결일", width: COL.completed.width, sortable: true, className: `${COL.completed.className} ${nowrap}` },
  { key: "activity", label: "마지막 활동일", width: COL.activity.width, sortable: true, className: `${COL.activity.className} ${nowrap}` },
  { key: "menu", label: "추가 메뉴", width: COL.menu.width, align: "center", className: nowrap },
];
