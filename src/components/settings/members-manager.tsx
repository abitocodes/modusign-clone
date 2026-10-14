"use client";

import { Ellipsis, KeyRound, Pencil, Plus, Trash2, UserCog } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { removeMember } from "@/app/workspaces/[wid]/settings/workspace/members/actions";
import { useWorkspace } from "@/components/shell/workspace-context";
import { CountPill } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/controls";
import { SearchInput } from "@/components/ui/input";
import { Cell, type Column, EmptyRows, FilterBar, paginate, Pagination, TableHeader, TableRow } from "@/components/ui/list-page";
import { Dropdown, MenuDivider, MenuItem, SelectMenu } from "@/components/ui/menu";
import { ConfirmModal } from "@/components/ui/modal";
import type { MemberRole } from "@/lib/types";
import { fmtDate } from "@/lib/utils";

import { AddMemberDialog, EditMemberDialog, ResetPasswordDialog, RoleDialog } from "./member-dialogs";
import { isAdminRole, memberMatches, ROLE_ORDER, type SettingsMember } from "./shared";
import { CardTitle, RoleBadge, SettingsCard } from "./ui";

type RoleFilter = "all" | MemberRole;
type DialogState =
  | { kind: "add" }
  | { kind: "role" | "edit" | "password" | "remove"; member: SettingsMember }
  | null;

const COLUMNS: Column[] = [
  { key: "name", label: "이름", width: 150 },
  { key: "username", label: "아이디", width: 110 },
  { key: "email", label: "이메일" },
  { key: "department", label: "부서", width: 92 },
  { key: "position", label: "직위", width: 70 },
  { key: "role", label: "역할", width: 96 },
  { key: "joined", label: "가입일", width: 92 },
  { key: "menu", label: "설정", width: 52, align: "center" },
];

export function MembersManager({
  members,
  primaryOwnerId,
  accountRole,
  companyOwnerIds,
}: {
  members: SettingsMember[];
  primaryOwnerId: string;
  /** caller's role in the company workspace (account-level permissions) */
  accountRole: MemberRole | null;
  companyOwnerIds: string[];
}) {
  const { workspace, role, profile } = useWorkspace();
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(10);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [, startTransition] = useTransition();

  const isAdmin = isAdminRole(role);
  const isPersonal = workspace.type === "personal";
  const canManageAccount = (m: SettingsMember) =>
    isAdminRole(accountRole) && (!companyOwnerIds.includes(m.id) || accountRole === "owner");

  const filtered = useMemo(
    () =>
      members
        .filter((m) => (roleFilter === "all" || m.role === roleFilter) && memberMatches(m, q))
        .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.joined_at.localeCompare(b.joined_at)),
    [members, q, roleFilter],
  );
  const { pageRows, pageCount, page: current } = paginate(filtered, page, size);

  const onRemove = (m: SettingsMember) =>
    startTransition(async () => {
      const id = toast.loading(`${m.name} 님을 삭제하는 중…`);
      const r = await removeMember(workspace.id, m.id);
      if (!r.ok) return void toast.error(r.error, { id });
      toast.success(r.data.accountDeleted ? `${m.name} 님의 계정을 삭제했습니다.` : `${m.name} 님을 워크스페이스에서 삭제했습니다.`, { id });
    });

  return (
    <SettingsCard>
      <CardTitle
        title={
          <span className="flex items-center gap-2">
            멤버 <CountPill>{members.length}명</CountPill>
          </span>
        }
        description={
          isAdmin
            ? "워크스페이스 멤버의 계정과 역할을 관리합니다. 직원 계정은 관리자가 직접 만들어 전달합니다."
            : "워크스페이스 멤버 목록입니다. 멤버 관리는 최고 관리자 또는 관리자만 할 수 있습니다."
        }
        actions={
          isAdmin && (
            <Button
              variant="neutral"
              icon={<Plus className="size-4" />}
              disabled={isPersonal}
              title={isPersonal ? "개인 워크스페이스에는 멤버를 추가할 수 없습니다." : undefined}
              onClick={() => setDialog({ kind: "add" })}
            >
              멤버 추가
            </Button>
          )
        }
      />

      <FilterBar>
        <SearchInput
          wrapperClassName="w-[280px]"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          placeholder="이름, 아이디, 이메일, 부서로 검색"
          aria-label="멤버 검색"
        />
        <SelectMenu<RoleFilter>
          value={roleFilter}
          width={150}
          onChange={(v) => {
            setRoleFilter(v);
            setPage(1);
          }}
          options={[
            { value: "all", label: "전체 역할" },
            { value: "owner", label: "최고 관리자" },
            { value: "admin", label: "관리자" },
            { value: "member", label: "멤버" },
          ]}
        />
        <span className="ml-auto pr-1 text-[13px] text-fg-muted">
          검색 결과 <b className="font-bold text-fg-2">{filtered.length}</b>명
        </span>
      </FilterBar>

      <div role="table" aria-label="멤버 목록">
        <TableHeader columns={COLUMNS} />
        {pageRows.length === 0 ? (
          <EmptyRows>
            {members.length === 0 ? "멤버가 없습니다." : "검색 조건에 맞는 멤버가 없습니다."}
            {(q || roleFilter !== "all") && (
              <button
                type="button"
                className="mt-2 text-[13px] text-emphasis underline underline-offset-2"
                onClick={() => {
                  setQ("");
                  setRoleFilter("all");
                }}
              >
                검색 조건 초기화
              </button>
            )}
          </EmptyRows>
        ) : (
          pageRows.map((m) => {
            const isMe = m.id === profile.id;
            const accountOk = canManageAccount(m);
            const isPrimary = m.id === primaryOwnerId;
            return (
              <TableRow key={m.id}>
                <Cell width={150}>
                  <div className="flex min-w-0 items-center gap-2">
                    <Avatar name={m.name} size={28} color={m.avatar_color} />
                    <span className="truncate font-medium text-fg" title={m.name}>
                      {m.name}
                    </span>
                    {isMe && (
                      <span className="shrink-0 rounded-full border border-emphasis-border px-1.5 text-[11px] font-medium leading-[18px] text-emphasis">
                        나
                      </span>
                    )}
                  </div>
                </Cell>
                <Cell width={110} className="truncate text-fg-2">
                  <span title={m.username ?? undefined}>{m.username ?? "-"}</span>
                </Cell>
                <Cell className="truncate text-fg-2">
                  <span title={m.email}>{m.email}</span>
                </Cell>
                <Cell width={92} className="truncate text-fg-2">
                  {m.department ?? "-"}
                </Cell>
                <Cell width={70} className="truncate text-fg-2">
                  {m.position ?? "-"}
                </Cell>
                <Cell width={96}>
                  <RoleBadge role={m.role} />
                </Cell>
                <Cell width={92} className="text-[13px] text-fg-muted">
                  {fmtDate(m.joined_at)}
                </Cell>
                <Cell width={52} align="center">
                  {isAdmin ? (
                    <Dropdown
                      align="right"
                      panelClassName="w-[188px]"
                      trigger={(open, toggle) => (
                        <button
                          type="button"
                          aria-label={`${m.name} 설정`}
                          aria-haspopup="menu"
                          aria-expanded={open}
                          onClick={toggle}
                          className="mx-auto flex size-8 items-center justify-center rounded text-icon-2 hover:bg-btn-light"
                        >
                          <Ellipsis className="size-[18px]" />
                        </button>
                      )}
                    >
                      {(close) => (
                        <>
                          <MenuItem
                            icon={<UserCog />}
                            disabled={isPersonal}
                            onClick={() => {
                              close();
                              setDialog({ kind: "role", member: m });
                            }}
                          >
                            역할 변경
                          </MenuItem>
                          <MenuItem
                            icon={<Pencil />}
                            disabled={!accountOk}
                            onClick={() => {
                              close();
                              setDialog({ kind: "edit", member: m });
                            }}
                          >
                            정보 수정
                          </MenuItem>
                          <MenuItem
                            icon={<KeyRound />}
                            disabled={!accountOk || isMe}
                            caption={isMe ? "개인 설정에서 변경" : undefined}
                            onClick={() => {
                              close();
                              setDialog({ kind: "password", member: m });
                            }}
                          >
                            비밀번호 초기화
                          </MenuItem>
                          <MenuDivider />
                          <MenuItem
                            icon={<Trash2 />}
                            danger
                            disabled={isMe || isPrimary || isPersonal || (m.role === "owner" && role !== "owner")}
                            caption={isPrimary ? "최고 관리자는 삭제 불가" : isMe ? "본인은 삭제 불가" : undefined}
                            onClick={() => {
                              close();
                              setDialog({ kind: "remove", member: m });
                            }}
                          >
                            멤버 삭제
                          </MenuItem>
                        </>
                      )}
                    </Dropdown>
                  ) : (
                    <span className="text-fg-disabled">-</span>
                  )}
                </Cell>
              </TableRow>
            );
          })
        )}
      </div>

      <Pagination
        page={current}
        pageCount={pageCount}
        onChange={setPage}
        pageSize={size}
        onPageSizeChange={(n) => {
          setSize(n);
          setPage(1);
        }}
      />

      {dialog?.kind === "add" && <AddMemberDialog onClose={() => setDialog(null)} />}
      {dialog?.kind === "role" && <RoleDialog member={dialog.member} callerRole={role} onClose={() => setDialog(null)} />}
      {dialog?.kind === "edit" && <EditMemberDialog member={dialog.member} onClose={() => setDialog(null)} />}
      {dialog?.kind === "password" && <ResetPasswordDialog member={dialog.member} onClose={() => setDialog(null)} />}
      <ConfirmModal
        open={dialog?.kind === "remove"}
        onClose={() => setDialog(null)}
        danger
        title="멤버를 삭제할까요?"
        confirmLabel="삭제"
        description={
          dialog?.kind === "remove" ? (
            <>
              <b className="text-fg">{dialog.member.name}</b> 님을 워크스페이스에서 삭제합니다.
              <br />
              다른 공용 워크스페이스에 속하지 않은 멤버는 <b className="text-negative">계정도 함께 삭제</b>되며, 이 멤버가 소유한 문서와
              템플릿은 회원님에게 이전됩니다.
            </>
          ) : null
        }
        onConfirm={() => {
          if (dialog?.kind === "remove") onRemove(dialog.member);
        }}
      />
    </SettingsCard>
  );
}
