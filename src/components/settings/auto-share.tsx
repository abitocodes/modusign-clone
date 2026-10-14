"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { setAutoShare } from "@/app/workspaces/[wid]/settings/esign/automatic-sharing/actions";
import { useWorkspace } from "@/components/shell/workspace-context";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/controls";
import { Cell, type Column, EmptyRows, paginate, Pagination, TableHeader, TableRow } from "@/components/ui/list-page";
import { SelectMenu } from "@/components/ui/menu";
import { fmtDate } from "@/lib/utils";

import { MemberPicker } from "./member-picker";
import { AUTO_SHARE_MAX, type AutoShareSettings, isAdminRole, type SettingsGroup, type SettingsMember } from "./shared";
import { CardTitle, Divider, RoleBadge, SettingsCard } from "./ui";

const COLUMNS: Column[] = [
  { key: "name", label: "이름", width: 240 },
  { key: "share", label: "문서 자동 공유" },
  { key: "joined", label: "가입일", width: 110 },
  { key: "menu", label: "설정", width: 80, align: "center" },
];

type Editing = { scope: "all" } | { scope: "member"; member: SettingsMember } | null;

export function AutoShareSettingsView({
  members,
  groups,
  autoShare,
}: {
  members: SettingsMember[];
  groups: SettingsGroup[];
  autoShare: AutoShareSettings;
}) {
  const { workspace, role, profile } = useWorkspace();
  const isAdmin = isAdminRole(role);
  const [editing, setEditing] = useState<Editing>(null);
  const [groupFilter, setGroupFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(10);
  const [pending, startTransition] = useTransition();

  const byId = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const resolve = (ids: string[] | undefined) => (ids ?? []).map((id) => byId.get(id)).filter((m): m is SettingsMember => !!m);

  const me = byId.get(profile.id);
  const mine = resolve(autoShare.mine[profile.id]);
  const all = resolve(autoShare.all);

  const rows = useMemo(() => {
    const g = groups.find((x) => x.id === groupFilter);
    return g ? members.filter((m) => g.memberIds.includes(m.id)) : members;
  }, [groups, groupFilter, members]);
  const { pageRows, pageCount, page: current } = paginate(rows, page, size);

  const save = (ids: string[]) => {
    if (!editing) return;
    const scope = editing.scope === "all" ? "all" : editing.member.id;
    startTransition(async () => {
      const r = await setAutoShare(workspace.id, scope, ids);
      if (!r.ok) return void toast.error(r.error);
      toast.success("문서 자동 공유 설정을 저장했습니다.");
      setEditing(null);
    });
  };

  const pickerInitial =
    editing?.scope === "all" ? autoShare.all : editing?.scope === "member" ? (autoShare.mine[editing.member.id] ?? []) : [];
  const pickerTitle =
    editing?.scope === "all"
      ? "모든 서명 요청 문서를 공유받는 멤버"
      : editing?.scope === "member" && editing.member.id === profile.id
        ? "내 문서 자동 공유 설정"
        : editing?.scope === "member"
          ? `${editing.member.name} 님의 문서 자동 공유 설정`
          : "";

  return (
    <SettingsCard>
      <CardTitle title="문서 자동 공유" description="서명 요청한 문서를 지정한 멤버의 문서함에 자동으로 공유합니다." />

      <ShareSection
        title="내가 서명 요청한 문서가 공유되는 그룹·멤버"
        description={`내가 서명 요청하는 문서가 자동으로 공유되는 그룹·멤버 (최대 ${AUTO_SHARE_MAX}개)`}
        targets={mine}
        onChange={me ? () => setEditing({ scope: "member", member: me }) : undefined}
      />
      <Divider className="my-6" />
      <ShareSection
        title="모든 서명 요청 문서를 공유받는 그룹·멤버"
        description={`워크스페이스에서 서명 요청되는 모든 문서가 자동으로 공유되는 그룹·멤버 (최대 ${AUTO_SHARE_MAX}개)`}
        targets={all}
        onChange={isAdmin ? () => setEditing({ scope: "all" }) : undefined}
        disabledReason={isAdmin ? undefined : "최고 관리자 또는 관리자만 변경할 수 있습니다."}
      />
      <Divider className="my-6" />

      <section>
        <h3 className="text-base font-bold text-fg">멤버별 자동 공유</h3>
        <p className="mt-1 text-[13px] text-fg-muted">멤버가 서명 요청한 문서가 자동으로 공유되는 그룹·멤버를 확인하고 변경할 수 있습니다.</p>
        <div className="mt-4 flex items-center justify-between">
          <span className="text-[13px] text-fg-2">
            인원: <b className="font-bold text-fg">{rows.length}</b>명
          </span>
          <SelectMenu<string>
            value={groupFilter}
            width={180}
            placeholder="그룹 선택"
            onChange={(v) => {
              setGroupFilter(v);
              setPage(1);
            }}
            options={[{ value: "all", label: "모든 멤버" }, ...groups.map((g) => ({ value: g.id, label: g.name }))]}
          />
        </div>
        <div role="table" aria-label="멤버별 자동 공유">
          <TableHeader columns={COLUMNS} />
          {pageRows.length === 0 ? (
            <EmptyRows>그룹에 속한 멤버가 없습니다.</EmptyRows>
          ) : (
            pageRows.map((m) => {
              const targets = resolve(autoShare.mine[m.id]);
              const canEdit = isAdmin || m.id === profile.id;
              return (
                <TableRow key={m.id}>
                  <Cell width={240}>
                    <div className="flex min-w-0 items-center gap-2">
                      <Avatar name={m.name} size={28} color={m.avatar_color} />
                      <span className="truncate font-medium text-fg">{m.name}</span>
                      <RoleBadge role={m.role} />
                    </div>
                  </Cell>
                  <Cell className="truncate text-fg-2">
                    <span title={targets.map((t) => t.name).join(", ") || undefined}>{summary(targets)}</span>
                  </Cell>
                  <Cell width={110} className="text-[13px] text-fg-muted">
                    {fmtDate(m.joined_at)}
                  </Cell>
                  <Cell width={80} align="center">
                    <Button
                      variant="outline"
                      size="xs"
                      className="px-3"
                      disabled={!canEdit}
                      title={canEdit ? undefined : "관리자만 변경할 수 있습니다."}
                      onClick={() => setEditing({ scope: "member", member: m })}
                    >
                      변경
                    </Button>
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
      </section>

      <MemberPicker
        open={!!editing}
        onClose={() => setEditing(null)}
        title={pickerTitle}
        description="문서를 자동으로 공유받을 멤버를 선택해 주세요. 그룹을 누르면 그룹의 멤버를 한 번에 추가할 수 있습니다."
        members={members}
        groups={groups}
        mode="multi"
        max={AUTO_SHARE_MAX}
        initial={pickerInitial.filter((id) => byId.has(id))}
        excludeIds={editing?.scope === "member" ? [editing.member.id] : []}
        allowEmpty
        confirmLabel="저장"
        pending={pending}
        onConfirm={save}
      />
    </SettingsCard>
  );
}

function summary(targets: SettingsMember[]) {
  if (targets.length === 0) return "없음";
  if (targets.length === 1) return targets[0].name;
  return `${targets[0].name} 외 ${targets.length - 1}명`;
}

function ShareSection({
  title,
  description,
  targets,
  onChange,
  disabledReason,
}: {
  title: string;
  description: string;
  targets: SettingsMember[];
  onChange?: () => void;
  disabledReason?: string;
}) {
  return (
    <section className="mt-7">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-bold text-fg">{title}</h3>
          <p className="mt-1 text-[13px] text-fg-muted">{description}</p>
        </div>
        <Button variant="outline" size="sm" disabled={!onChange} title={disabledReason} onClick={onChange}>
          설정 변경
        </Button>
      </div>
      <div className="mt-4 flex min-h-[52px] flex-wrap items-center gap-1.5 rounded-lg border border-line-light bg-surface-2 px-4 py-3">
        {targets.length === 0 ? (
          <span className="text-[13px] text-fg-muted">공유되는 그룹·멤버가 없습니다.</span>
        ) : (
          targets.map((t) => (
            <span
              key={t.id}
              className="inline-flex h-7 items-center gap-1.5 rounded-full border border-line-light bg-surface-4 pl-1 pr-2.5 text-xs font-medium text-fg"
            >
              <Avatar name={t.name} size={20} color={t.avatar_color} />
              {t.name}
            </span>
          ))
        )}
      </div>
    </section>
  );
}
