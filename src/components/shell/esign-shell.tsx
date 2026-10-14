"use client";

import { PanelLeft, Settings, Sparkles } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";

import { HelpMenu, ProfileMenu, WorkspaceSwitcher } from "./header-menus";
import { useWorkspace } from "./workspace-context";

const SidebarCtx = createContext<{ collapsed: boolean; toggle: () => void }>({ collapsed: false, toggle: () => {} });
export const useSidebarState = () => useContext(SidebarCtx);

const TABS = [
  { key: "home", label: "홈", href: "/esign/home" },
  { key: "requests", label: "서명 요청", href: "/esign/requests/request" },
  { key: "documents", label: "문서함", href: "/esign/documents/documents?status=all" },
] as const;

/** Header (workspace switcher, 홈/서명 요청/문서함 tabs, AI 계약관리, settings, help, profile). */
export function ESignShell({ children }: { children: ReactNode }) {
  const { workspace } = useWorkspace();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const base = `/workspaces/${workspace.id}`;
  const active = pathname.includes("/esign/requests") ? "requests" : pathname.includes("/esign/documents") ? "documents" : "home";
  const hasSidebar = active !== "home";

  return (
    <SidebarCtx.Provider value={{ collapsed, toggle: () => setCollapsed((c) => !c) }}>
      <div className="flex min-h-screen flex-col bg-body-2">
        <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center border-b border-line bg-surface">
          <div className="flex h-full w-[280px] shrink-0 items-center gap-1 border-r border-line pl-3.5 pr-3">
            {hasSidebar && (
              <button
                type="button"
                aria-label="사이드바 접기"
                onClick={() => setCollapsed((c) => !c)}
                className="mr-0.5 flex size-8 shrink-0 items-center justify-center rounded text-fg-3 hover:bg-btn-light"
              >
                <PanelLeft className="size-[18px]" />
              </button>
            )}
            <WorkspaceSwitcher />
          </div>
          <nav className="flex h-full flex-1 justify-center">
            {TABS.map((t) => (
              <Link
                key={t.key}
                href={base + t.href}
                className={cn(
                  "flex h-full w-[132px] items-center justify-center border-b-2 text-base font-medium transition-colors",
                  active === t.key ? "border-fg text-fg" : "border-transparent text-fg-faint hover:text-fg-2",
                )}
              >
                {t.label}
              </Link>
            ))}
          </nav>
          <div className="flex shrink-0 items-center gap-3 pr-4">
            <button
              type="button"
              onClick={() => toast("AI 계약관리는 준비 중입니다.")}
              className="flex h-9 items-center gap-1.5 rounded-md border border-emphasis-border bg-emphasis-bg px-3 text-[13px] font-medium text-fg"
            >
              <Sparkles className="size-3.5 text-[#8b7dff]" fill="#8b7dff" />
              AI 계약관리
            </button>
            <Link
              href={`${base}/settings/workspace/info`}
              aria-label="통합 설정"
              className="flex size-10 items-center justify-center rounded-full text-icon hover:bg-btn-light"
            >
              <Settings className="size-[22px]" fill="currentColor" stroke="var(--surface)" strokeWidth={1.6} />
            </Link>
            <HelpMenu />
            <ProfileMenu />
          </div>
        </header>
        <div className="flex min-h-0 flex-1">{children}</div>
        <HelpFab />
      </div>
    </SidebarCtx.Provider>
  );
}

export function HelpFab() {
  return (
    <button
      type="button"
      aria-label="채팅 상담"
      onClick={() => toast("채팅 상담은 준비 중입니다.")}
      className="fixed bottom-7 right-7 z-30 flex size-14 items-center justify-center rounded-2xl bg-[#3a4250] text-white shadow-menu hover:brightness-110"
    >
      <svg viewBox="0 0 32 32" className="size-8" aria-hidden>
        <path d="M16 3C8.8 3 3 8.4 3 15c0 3.3 1.4 6.2 3.7 8.4L5.5 29l6-2.6c1.4.4 2.9.6 4.5.6 7.2 0 13-5.4 13-12S23.2 3 16 3z" fill="#fff" />
        <text x="16" y="21" textAnchor="middle" fontSize="15" fontWeight="800" fill="#3a4250" fontFamily="sans-serif">
          ?
        </text>
      </svg>
    </button>
  );
}
