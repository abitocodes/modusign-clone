"use client";

import { ChevronDown, CircleHelp, LayoutGrid, Settings } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Avatar } from "@/components/ui/controls";
import { Dropdown, MenuDivider, MenuItem } from "@/components/ui/menu";
import { createClient } from "@/lib/supabase/client";
import { cn, initials } from "@/lib/utils";

import { LogoMark } from "./logo";
import { useWorkspace } from "./workspace-context";

const ROLE_LABEL = { owner: "최고 관리자", admin: "관리자", member: "멤버" } as const;

/** "dkko의 워크스페이스 ∨" + switcher panel */
export function WorkspaceSwitcher({ compact = false }: { compact?: boolean }) {
  const { workspace, workspaces } = useWorkspace();
  const router = useRouter();
  return (
    <Dropdown
      className="min-w-0"
      panelClassName="w-[348px] p-2"
      trigger={(open, toggle) => (
        <div className="flex min-w-0 items-center gap-2">
          {!compact && <LogoMark />}
          <button
            type="button"
            onClick={toggle}
            className={cn(
              "flex h-11 min-w-0 items-center gap-2 rounded-md px-1.5 text-left transition-colors hover:bg-btn-light",
              open && "bg-emphasis-bg text-emphasis",
            )}
          >
            <h2 className={cn("truncate text-base font-bold", open ? "text-emphasis" : "text-fg")}>{workspace.name}</h2>
            <ChevronDown className="size-4 shrink-0 text-fg-muted" />
          </button>
        </div>
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
                router.push(`/workspaces/${w.id}/esign/home`);
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
          <MenuItem icon={<LayoutGrid />} onClick={() => { close(); toast("워크스페이스 목록은 준비 중입니다."); }}>
            워크스페이스 목록
          </MenuItem>
          <MenuItem icon={<Settings />} onClick={() => { close(); router.push(`/workspaces/${workspace.id}/settings/workspace/info`); }}>
            워크스페이스 관리
          </MenuItem>
        </>
      )}
    </Dropdown>
  );
}

export function HelpMenu() {
  return (
    <Dropdown
      align="right"
      panelClassName="w-[194px]"
      trigger={(open, toggle) => (
        <button
          type="button"
          aria-label="도움말"
          onClick={toggle}
          className="flex size-10 items-center justify-center rounded-full hover:bg-btn-light"
        >
          <CircleHelp className={cn("size-[22px]", open ? "fill-emphasis text-surface" : "fill-icon text-surface")} strokeWidth={2.4} />
        </button>
      )}
    >
      {(close) =>
        ["매뉴얼 바로가기", "전자서명 이용 가이드", "문서 위·변조 검증센터", "채팅 상담하기"].map((t) => (
          <MenuItem key={t} onClick={() => { close(); toast(`${t}: 준비 중입니다.`); }}>
            {t}
          </MenuItem>
        ))
      }
    </Dropdown>
  );
}

export function ProfileMenu() {
  const { profile, role, workspace } = useWorkspace();
  const router = useRouter();
  return (
    <Dropdown
      align="right"
      panelClassName="w-[252px] py-0"
      trigger={(_open, toggle) => (
        <button type="button" aria-label="내 계정" onClick={toggle} className="flex size-10 items-center justify-center rounded-full">
          <Avatar name={profile.name} size={40} color={profile.avatar_color} />
        </button>
      )}
    >
      {(close) => (
        <>
          <div className="flex items-start gap-3 px-4 py-4">
            <Avatar name={profile.name} size={40} color={profile.avatar_color} />
            <div className="min-w-0">
              <p className="truncate text-[15px] font-bold text-fg">{profile.name}</p>
              <p className="text-xs text-fg-2">{ROLE_LABEL[role]}</p>
              <p className="truncate text-xs text-fg-muted">{profile.email}</p>
            </div>
          </div>
          <div className="h-px bg-line-strong" />
          <Link
            href={`/workspaces/${workspace.id}/settings/personal/member`}
            onClick={close}
            className="block px-4 py-3.5 hover:bg-menu-hover"
          >
            <span className="block text-sm text-fg">계정 관리</span>
            <span className="block text-[11px] text-fg-muted">개인 정보, 인증, 비밀번호 등</span>
          </Link>
          <div className="h-px bg-line-strong" />
          <button
            type="button"
            className="block w-full px-4 py-3.5 text-left text-sm text-fg hover:bg-menu-hover"
            onClick={async () => {
              close();
              await createClient().auth.signOut();
              router.replace("/login");
              router.refresh();
            }}
          >
            로그아웃
          </button>
        </>
      )}
    </Dropdown>
  );
}
