"use client";

import { Ellipsis, Pencil, Plus, Trash2, UserPlus, Users, X } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  createGroup,
  deleteGroup,
  removeGroupMember,
  renameGroup,
  setGroupMembers,
} from "@/app/workspaces/[wid]/settings/workspace/groups/actions";
import { useWorkspace } from "@/components/shell/workspace-context";
import { CountPill } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/controls";
import { Input } from "@/components/ui/input";
import { Dropdown, MenuItem } from "@/components/ui/menu";
import { ConfirmModal, Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";

import { MemberPicker } from "./member-picker";
import { isAdminRole, type SettingsGroup, type SettingsMember } from "./shared";
import { CardTitle, EmptyState, RoleBadge, SettingsCard } from "./ui";

const ALL = "__all__";
const GROUP_NAME_MAX = 30;

export function GroupsManager({ members, groups }: { members: SettingsMember[]; groups: SettingsGroup[] }) {
  const { workspace, role } = useWorkspace();
  const isAdmin = isAdminRole(role);
  const [selectedId, setSelectedId] = useState<string>(ALL);
  const [nameDialog, setNameDialog] = useState<{ mode: "create" } | { mode: "rename"; group: SettingsGroup } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<SettingsGroup | null>(null);
  const [pending, startTransition] = useTransition();

  const selected = groups.find((g) => g.id === selectedId) ?? null;
  const isAll = !selected;
  const byId = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const shown: SettingsMember[] = isAll
    ? members
    : selected.memberIds.map((id) => byId.get(id)).filter((m): m is SettingsMember => !!m);

  const saveName = (name: string) =>
    startTransition(async () => {
      if (nameDialog?.mode === "rename") {
        const r = await renameGroup(workspace.id, nameDialog.group.id, name);
        if (!r.ok) return void toast.error(r.error);
        toast.success("그룹 이름을 변경했습니다.");
      } else {
        const r = await createGroup(workspace.id, name);
        if (!r.ok) return void toast.error(r.error);
        setSelectedId(r.data.id);
        toast.success("그룹을 만들었습니다.");
      }
      setNameDialog(null);
    });

  const saveMembers = (ids: string[]) => {
    if (!selected) return;
    startTransition(async () => {
      const r = await setGroupMembers(workspace.id, selected.id, ids);
      if (!r.ok) return void toast.error(r.error);
      toast.success("그룹 멤버를 저장했습니다.");
      setPickerOpen(false);
    });
  };

  const removeOne = (m: SettingsMember) => {
    if (!selected) return;
    startTransition(async () => {
      const r = await removeGroupMember(workspace.id, selected.id, m.id);
      if (!r.ok) return void toast.error(r.error);
      toast.success(`${m.name} 님을 그룹에서 제외했습니다.`);
    });
  };

  return (
    <SettingsCard>
      <CardTitle
        title="그룹"
        description="부서나 프로젝트 단위로 멤버를 묶어 관리합니다. 그룹은 문서 자동 공유 설정 등에 활용할 수 있습니다."
        actions={
          isAdmin && (
            <Button variant="neutral" icon={<Plus className="size-4" />} onClick={() => setNameDialog({ mode: "create" })}>
              그룹 만들기
            </Button>
          )
        }
      />

      <div className="mt-6 flex min-h-[420px] overflow-hidden rounded-lg border border-line">
        {/* group list */}
        <nav aria-label="그룹 목록" className="w-[232px] shrink-0 overflow-y-auto border-r border-line bg-surface-2 p-2">
          <GroupRow label="모든 멤버" count={members.length} active={isAll} onClick={() => setSelectedId(ALL)} />
          {groups.length > 0 && <div className="mx-2 my-2 h-px bg-line-light" />}
          {groups.map((g) => (
            <GroupRow
              key={g.id}
              label={g.name}
              count={g.memberIds.filter((id) => byId.has(id)).length}
              active={g.id === selectedId}
              onClick={() => setSelectedId(g.id)}
            />
          ))}
          {groups.length === 0 && (
            <p className="px-3 py-4 text-xs leading-relaxed text-fg-muted">
              아직 만든 그룹이 없습니다.
              {isAdmin && (
                <>
                  <br />
                  [그룹 만들기]로 첫 그룹을 만들어 보세요.
                </>
              )}
            </p>
          )}
        </nav>

        {/* members of the selected group */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-[60px] shrink-0 items-center justify-between gap-3 border-b border-line px-5">
            <div className="flex min-w-0 items-center gap-2">
              <h3 className="truncate text-base font-bold text-fg">{isAll ? "모든 멤버" : selected.name}</h3>
              <CountPill>{shown.length}명</CountPill>
            </div>
            {isAdmin && selected && (
              <div className="flex shrink-0 items-center gap-1.5">
                <Button variant="outline" size="sm" icon={<UserPlus className="size-3.5" />} onClick={() => setPickerOpen(true)}>
                  멤버 편집
                </Button>
                <Dropdown
                  align="right"
                  panelClassName="w-[150px]"
                  trigger={(open, toggle) => (
                    <button
                      type="button"
                      aria-label="그룹 설정"
                      aria-haspopup="menu"
                      aria-expanded={open}
                      onClick={toggle}
                      className="flex size-8 items-center justify-center rounded text-icon-2 hover:bg-btn-light"
                    >
                      <Ellipsis className="size-[18px]" />
                    </button>
                  )}
                >
                  {(close) => (
                    <>
                      <MenuItem
                        icon={<Pencil />}
                        onClick={() => {
                          close();
                          setNameDialog({ mode: "rename", group: selected });
                        }}
                      >
                        이름 변경
                      </MenuItem>
                      <MenuItem
                        icon={<Trash2 />}
                        danger
                        onClick={() => {
                          close();
                          setConfirmDelete(selected);
                        }}
                      >
                        그룹 삭제
                      </MenuItem>
                    </>
                  )}
                </Dropdown>
              </div>
            )}
          </div>

          {isAll && (
            <p className="border-b border-line-light bg-surface-2 px-5 py-2.5 text-xs text-fg-muted">
              워크스페이스의 모든 멤버가 자동으로 포함되는 기본 그룹입니다.
            </p>
          )}

          {shown.length === 0 ? (
            <EmptyState
              title="그룹에 속한 멤버가 없습니다."
              description={isAdmin ? "멤버를 추가해 그룹을 구성해 보세요." : undefined}
              action={
                isAdmin &&
                selected && (
                  <Button variant="outline" icon={<UserPlus className="size-4" />} onClick={() => setPickerOpen(true)}>
                    멤버 추가
                  </Button>
                )
              }
            />
          ) : (
            <ul className="min-h-0 flex-1 overflow-y-auto">
              {shown.map((m) => (
                <li key={m.id} className="flex items-center gap-3 border-b border-line-light px-5 py-3 last:border-b-0">
                  <Avatar name={m.name} size={32} color={m.avatar_color} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-fg">{m.name}</p>
                    <p className="truncate text-xs text-fg-muted">
                      {m.email}
                      {(m.department || m.position) && ` · ${[m.department, m.position].filter(Boolean).join(" ")}`}
                    </p>
                  </div>
                  <RoleBadge role={m.role} />
                  {isAdmin && selected && (
                    <button
                      type="button"
                      aria-label={`${m.name} 그룹에서 제외`}
                      title="그룹에서 제외"
                      disabled={pending}
                      onClick={() => removeOne(m)}
                      className="flex size-7 items-center justify-center rounded text-fg-faint hover:bg-btn-light hover:text-fg disabled:opacity-40"
                    >
                      <X className="size-4" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {nameDialog && (
        <GroupNameDialog
          title={nameDialog.mode === "create" ? "그룹 만들기" : "그룹 이름 변경"}
          initial={nameDialog.mode === "rename" ? nameDialog.group.name : ""}
          confirmLabel={nameDialog.mode === "create" ? "만들기" : "변경"}
          pending={pending}
          onClose={() => setNameDialog(null)}
          onSubmit={saveName}
        />
      )}

      {selected && (
        <MemberPicker
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          title={`${selected.name} 멤버 편집`}
          description="그룹에 포함할 멤버를 선택해 주세요."
          members={members}
          mode="multi"
          initial={selected.memberIds.filter((id) => byId.has(id))}
          allowEmpty
          confirmLabel="저장"
          pending={pending}
          onConfirm={saveMembers}
        />
      )}

      <ConfirmModal
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        danger
        title="그룹을 삭제할까요?"
        confirmLabel="삭제"
        description={
          confirmDelete && (
            <>
              <b className="text-fg">{confirmDelete.name}</b> 그룹을 삭제합니다.
              <br />
              그룹에 속한 멤버의 계정은 삭제되지 않습니다.
            </>
          )
        }
        onConfirm={() => {
          const g = confirmDelete;
          if (!g) return;
          startTransition(async () => {
            const r = await deleteGroup(workspace.id, g.id);
            if (!r.ok) return void toast.error(r.error);
            if (selectedId === g.id) setSelectedId(ALL);
            toast.success("그룹을 삭제했습니다.");
          });
        }}
      />
    </SettingsCard>
  );
}

function GroupRow({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      className={cn(
        "mb-0.5 flex h-[38px] w-full items-center gap-2 rounded px-3 text-left text-sm transition-colors",
        active ? "bg-emphasis-bg font-bold text-emphasis" : "text-fg hover:bg-surface-4",
      )}
    >
      <Users className={cn("size-4 shrink-0", active ? "text-emphasis" : "text-fg-faint")} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className={cn("text-xs font-medium", active ? "text-emphasis" : "text-fg-faint")}>{count}</span>
    </button>
  );
}

function GroupNameDialog({
  title,
  initial,
  confirmLabel,
  pending,
  onClose,
  onSubmit,
}: {
  title: string;
  initial: string;
  confirmLabel: string;
  pending: boolean;
  onClose: () => void;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState(initial);
  const trimmed = name.trim();
  const valid = trimmed.length > 0 && trimmed.length <= GROUP_NAME_MAX && trimmed !== initial;
  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      icon={<Users />}
      width={480}
      footer={
        <>
          <Button variant="light" onClick={onClose}>
            취소
          </Button>
          <Button variant="primary" type="submit" form="group-name-form" disabled={!valid || pending}>
            {pending ? "저장 중…" : confirmLabel}
          </Button>
        </>
      }
    >
      <form
        id="group-name-form"
        className="px-[30px] pb-2 pt-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid && !pending) onSubmit(trimmed);
        }}
      >
        <label htmlFor="group-name" className="mb-2 block text-sm font-medium text-fg">
          그룹 이름
        </label>
        <Input
          id="group-name"
          value={name}
          maxLength={GROUP_NAME_MAX}
          autoFocus
          placeholder={`${GROUP_NAME_MAX}자 이내로 입력 (예: 영업팀)`}
          onChange={(e) => setName(e.target.value)}
        />
        <p className="mt-1.5 text-right text-[11px] text-fg-muted">
          {name.length}/{GROUP_NAME_MAX}
        </p>
      </form>
    </Modal>
  );
}
