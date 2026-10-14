"use client";

import { ArrowLeft, ChevronDown, House } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { toast } from "sonner";

import { HelpMenu, ProfileMenu } from "@/components/shell/header-menus";
import { Wordmark } from "@/components/shell/logo";
import { useWorkspace } from "@/components/shell/workspace-context";
import { Dropdown, MenuDivider, MenuItem } from "@/components/ui/menu";
import { cn, initials } from "@/lib/utils";

import { activeSettingsTab, SETTINGS_NAV, SETTINGS_TABS } from "./settings-nav";

/** 통합 설정 chrome: header (back · wordmark · tabs · help · profile), left sidebar, main area. */
export function SettingsShell({ children }: { children: ReactNode }) {
  const { workspace } = useWorkspace();
  const pathname = usePathname();
  const base = `/workspaces/${workspace.id}`;
  const tab = activeSettingsTab(pathname);

  return (
    <div className="flex min-h-screen flex-col bg-body-2">
      <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center border-b border-line bg-surface">
        <div className="flex h-full w-[272px] shrink-0 items-center gap-2 border-r border-line pl-2.5 pr-3">
          <Link
            href={`${base}/esign/home`}
            aria-label="전자서명 홈으로 돌아가기"
            className="flex size-9 shrink-0 items-center justify-center rounded-md text-icon hover:bg-btn-light"
          >
            <ArrowLeft className="size-5" />
          </Link>
          <Wordmark className="text-sm" />
          <h2 className="text-sm font-medium text-fg-muted">통합 설정</h2>
        </div>
        <nav aria-label="통합 설정 메뉴" className="ml-4 flex h-full flex-1">
          {SETTINGS_TABS.map((t) => {
            const active = t.key === tab;
            const cls = cn(
              "flex h-full w-[132px] shrink-0 items-center justify-center border-b-2 text-base font-medium transition-colors",
              active ? "border-fg text-fg" : "border-transparent text-fg-faint hover:text-fg-2",
            );
            return t.href ? (
              <Link key={t.key} href={base + t.href} aria-current={active ? "page" : undefined} className={cls}>
                {t.label}
              </Link>
            ) : (
              <button key={t.key} type="button" className={cls} onClick={() => toast("캐비닛 설정은 준비 중입니다.")}>
                {t.label}
              </button>
            );
          })}
        </nav>
        <div className="flex shrink-0 items-center gap-3 pr-4">
          <HelpMenu />
          <ProfileMenu />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="sticky top-14 flex h-[calc(100vh-56px)] w-[272px] shrink-0 flex-col border-r border-line bg-surface">
          <div className="shrink-0 border-b border-line px-2 py-[5px]">
            <SettingsWorkspaceSwitcher />
          </div>
          <nav aria-label="설정 항목" className="min-h-0 flex-1 overflow-y-auto px-3 pb-8 pt-5">
            {SETTINGS_NAV[tab].map((g, gi) => (
              <div key={g.label} className={cn(gi > 0 && "mt-6")}>
                <p className="px-2 pb-2 text-[13px] font-medium text-fg-muted">{g.label}</p>
                {g.items.map((it) => {
                  const href = base + it.href;
                  const active = pathname === href || pathname.startsWith(href + "/");
                  return (
                    <Link
                      key={it.href}
                      href={href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "mb-1 flex h-[38px] items-center rounded px-2 text-base transition-colors",
                        active ? "bg-emphasis-bg font-bold text-emphasis" : "font-normal text-fg hover:bg-surface-3",
                      )}
                    >
                      {it.label}
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>
        </aside>

        <main className="min-w-0 flex-1 px-6 pb-16 pt-3">
          <div className="mx-auto w-full max-w-[912px]">{children}</div>
        </main>
      </div>
    </div>
  );
}

/** Workspace selector at the top of the settings sidebar — switching keeps the current settings page. */
function SettingsWorkspaceSwitcher() {
  const { workspace, workspaces } = useWorkspace();
  const router = useRouter();
  const pathname = usePathname();
  const sub = pathname.replace(/^\/workspaces\/[^/]+/, "") || "/settings/workspace/info";

  return (
    <Dropdown
      className="w-full"
      panelClassName="w-[348px] p-2"
      trigger={(open, toggle) => (
        <button
          type="button"
          onClick={toggle}
          aria-haspopup="menu"
          aria-expanded={open}
          className={cn(
            "flex h-11 w-full items-center justify-between gap-2 rounded-md px-2 text-left transition-colors hover:bg-btn-light",
            open && "bg-emphasis-bg",
          )}
        >
          <span className={cn("truncate text-base font-bold", open ? "text-emphasis" : "text-fg")}>{workspace.name}</span>
          <ChevronDown className={cn("size-4 shrink-0 text-fg-muted transition-transform", open && "rotate-180")} />
        </button>
      )}
    >
      {(close) => (
        <>
          {workspaces.map((w) => (
            <button
              key={w.id}
              type="button"
              onClick={() => {
                close();
                if (w.id !== workspace.id) router.push(`/workspaces/${w.id}${sub}`);
              }}
              className={cn(
                "flex h-[55px] w-full items-center gap-3 rounded-md px-2 text-left hover:bg-menu-hover",
                w.id === workspace.id && "bg-menu-hover",
              )}
            >
              <span
                className="flex size-9 shrink-0 items-center justify-center rounded-full text-[13px] font-bold text-white"
                style={{
                  background:
                    w.type === "team" ? "linear-gradient(135deg,#b38cff,#f08fc0)" : "linear-gradient(135deg,#ffb35c,#f77f4f)",
                }}
              >
                {initials(w.name)}
              </span>
              <span className="flex-1 truncate text-sm font-bold text-fg">{w.name}</span>
              {w.is_default ? (
                <span className="rounded-full border border-emphasis-border px-2 py-0.5 text-[11px] font-medium text-emphasis">기본</span>
              ) : (
                <span className="rounded-full bg-surface-4 px-2 py-0.5 text-[11px] font-medium text-fg-2">
                  {w.type === "personal" ? "개인" : "팀"}
                </span>
              )}
            </button>
          ))}
          <MenuDivider />
          <MenuItem
            icon={<House />}
            onClick={() => {
              close();
              router.push(`/workspaces/${workspace.id}/esign/home`);
            }}
          >
            전자서명 홈으로 이동
          </MenuItem>
        </>
      )}
    </Dropdown>
  );
}
