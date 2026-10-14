"use client";

import { Send } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Fragment } from "react";

import { cn } from "@/lib/utils";

import { useSidebarState } from "./esign-shell";
import { useWorkspace } from "./workspace-context";

export interface SidebarItem {
  label: string;
  /** path under /workspaces/[wid] (may include ?query) */
  href: string;
  /** custom active matcher */
  match?: (pathname: string, search: URLSearchParams) => boolean;
}
export interface SidebarGroup {
  label?: string;
  items: SidebarItem[];
}

export function isItemActive(item: SidebarItem, base: string, pathname: string, search: URLSearchParams) {
  if (item.match) return item.match(pathname, search);
  const [p, q] = item.href.split("?");
  if (pathname !== base + p && !pathname.startsWith(base + p + "/")) return false;
  if (!q) return true;
  const want = new URLSearchParams(q);
  for (const [k, v] of want) if ((search.get(k) ?? (k === "status" ? "all" : null)) !== v) return false;
  return true;
}

/** Left sidebar of the 서명 요청 / 문서함 sections. */
export function ESignSidebar({ groups }: { groups: SidebarGroup[] }) {
  const { workspace } = useWorkspace();
  const { collapsed } = useSidebarState();
  const pathname = usePathname();
  const search = useSearchParams();
  const base = `/workspaces/${workspace.id}`;

  if (collapsed) return null;

  return (
    <aside className="sticky top-14 flex h-[calc(100vh-56px)] w-[280px] shrink-0 flex-col border-r border-line bg-surface">
      <div className="shrink-0 border-b border-line px-3.5 py-[18px]">
        <Link
          href={`${base}/esign/requests/request`}
          className="flex h-[42px] w-full items-center justify-center gap-2 rounded-md bg-primary text-base font-medium text-primary-fg shadow-button hover:bg-primary-hover"
        >
          <Send className="size-[18px] -rotate-12" fill="currentColor" />
          서명 요청 시작하기
        </Link>
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto px-3 pb-6 pt-4">
        {groups.map((g, gi) => (
          <Fragment key={gi}>
            {gi > 0 && <div className="my-3 h-px bg-line" />}
            {g.label && <p className="px-2 pb-2.5 pt-2 text-[13px] font-medium text-fg-muted">{g.label}</p>}
            {g.items.map((it) => {
              const active = isItemActive(it, base, pathname, search);
              return (
                <Link
                  key={it.href}
                  href={base + it.href}
                  className={cn(
                    "mb-1 flex h-[38px] items-center rounded px-2 text-base transition-colors",
                    active ? "bg-emphasis-bg font-bold text-emphasis" : "font-normal text-fg hover:bg-surface-3",
                  )}
                >
                  {it.label}
                </Link>
              );
            })}
          </Fragment>
        ))}
      </nav>
    </aside>
  );
}

export const REQUESTS_SIDEBAR: SidebarGroup[] = [
  { items: [{ label: "요청 방식", href: "/esign/requests/request" }] },
  {
    label: "서명 요청",
    items: [
      { label: "템플릿", href: "/esign/requests/templates" },
      { label: "대량전송", href: "/esign/requests/bulk-requests" },
      { label: "링크서명", href: "/esign/requests/links" },
    ],
  },
  {
    label: "서명·결재",
    items: [
      { label: "사인·도장", href: "/esign/requests/signatures" },
      { label: "내부결재", href: "/esign/requests/approvals" },
      { label: "결재선", href: "/esign/requests/approval-processes" },
    ],
  },
  {
    label: "도구",
    items: [
      { label: "맞춤 입력란", href: "/esign/requests/custom-fields" },
      { label: "주소록", href: "/esign/requests/address-book" },
    ],
  },
  {
    label: "편집",
    items: [
      { label: "문서 편집기", href: "/esign/requests/editing-documents" },
      { label: "서식 작성기", href: "/esign/requests/drafts" },
    ],
  },
];

const statusItem = (label: string, status: string): SidebarItem => ({
  label,
  href: `/esign/documents/documents?status=${status}`,
});

export const DOCUMENTS_SIDEBAR: SidebarGroup[] = [
  { items: [statusItem("모든 상태", "all")] },
  {
    label: "진행 중",
    items: [
      statusItem("내 서명 필요", "need_signing"),
      statusItem("상대 서명 대기 중", "wait_for_signing"),
      statusItem("내 열람 필요", "need_viewing"),
      statusItem("상대 열람 필요", "wait_for_viewing"),
    ],
  },
  {
    label: "종결",
    items: [
      statusItem("서명 완료", "signing_completed"),
      statusItem("열람 완료", "viewing_completed"),
      statusItem("서명 거절", "rejected"),
      statusItem("서명 취소", "signing_cancelled"),
      statusItem("요청 취소", "request_cancelled"),
    ],
  },
  {
    label: "요청 전",
    items: [statusItem("작성 중", "draft"), statusItem("수정 중", "on_modifying"), statusItem("예약", "scheduled")],
  },
  {
    label: "문서 관리",
    items: [
      { label: "데이터 추출", href: "/esign/documents/data-export" },
      { label: "리마인더", href: "/esign/documents/reminders" },
    ],
  },
];
