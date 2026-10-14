"use client";

import { Users } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Avatar, Checkbox, Radio } from "@/components/ui/controls";
import { SearchInput } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";

import { memberMatches, type SettingsGroup, type SettingsMember } from "./shared";
import { RoleBadge } from "./ui";

export interface MemberPickerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  members: SettingsMember[];
  mode: "single" | "multi";
  initial?: string[];
  /** ids that cannot be chosen (still listed, disabled) */
  disabledIds?: string[];
  /** hide these ids completely */
  excludeIds?: string[];
  max?: number;
  /** multi mode: quick "add all members of a group" chips */
  groups?: SettingsGroup[];
  confirmLabel?: string;
  /** allow confirming with nothing selected (e.g. clearing a setting) */
  allowEmpty?: boolean;
  pending?: boolean;
  onConfirm: (ids: string[]) => void;
}

/** Dialog that picks one or several workspace members (search, avatars, role badges). */
export function MemberPicker(props: MemberPickerProps) {
  // Mount the stateful body only while open so the selection resets on every open.
  if (!props.open) return null;
  return <MemberPickerDialog {...props} />;
}

function MemberPickerDialog({
  onClose,
  title,
  description,
  members,
  mode,
  initial = [],
  disabledIds = [],
  excludeIds = [],
  max,
  groups = [],
  confirmLabel = "확인",
  allowEmpty = false,
  pending = false,
  onConfirm,
}: MemberPickerProps) {
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string[]>(initial);

  const visible = useMemo(
    () => members.filter((m) => !excludeIds.includes(m.id) && memberMatches(m, q)),
    [members, excludeIds, q],
  );

  // Side effects (toasts) stay outside the state updaters so they fire once per click.
  const toggle = (id: string) => {
    if (mode === "single") {
      setSelected([id]);
      return;
    }
    if (selected.includes(id)) {
      setSelected(selected.filter((x) => x !== id));
      return;
    }
    if (max && selected.length >= max) {
      toast.error(`최대 ${max}명까지 선택할 수 있습니다.`);
      return;
    }
    setSelected([...selected, id]);
  };

  const addGroup = (g: SettingsGroup) => {
    const allowed = new Set(members.filter((m) => !excludeIds.includes(m.id) && !disabledIds.includes(m.id)).map((m) => m.id));
    const next = [...selected];
    let capped = false;
    for (const id of g.memberIds) {
      if (!allowed.has(id) || next.includes(id)) continue;
      if (max && next.length >= max) {
        capped = true;
        break;
      }
      next.push(id);
    }
    setSelected(next);
    if (capped) toast.error(`최대 ${max}명까지 선택할 수 있습니다.`);
  };

  const canConfirm = !pending && (allowEmpty || selected.length > 0);

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      icon={<Users />}
      width={560}
      footerBar
      footerAlign="between"
      footer={
        <>
          <span className="text-[13px] text-fg-muted">
            {mode === "multi" ? (
              <>
                <b className="font-bold text-emphasis">{selected.length}</b>명 선택{max ? ` (최대 ${max}명)` : ""}
              </>
            ) : null}
          </span>
          <div className="flex gap-2">
            <Button variant="light" onClick={onClose}>
              취소
            </Button>
            <Button variant="primary" disabled={!canConfirm} onClick={() => onConfirm(selected)}>
              {pending ? "저장 중…" : confirmLabel}
            </Button>
          </div>
        </>
      }
    >
      <div className="px-[30px] pb-4 pt-5">
        {description && <p className="mb-4 text-[13px] leading-relaxed text-fg-2">{description}</p>}
        <SearchInput
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="이름, 아이디, 이메일, 부서로 검색"
          aria-label="멤버 검색"
          autoFocus
        />
        {mode === "multi" && groups.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs text-fg-muted">그룹으로 추가</span>
            {groups.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => addGroup(g)}
                disabled={g.memberIds.length === 0}
                className="h-7 rounded-full border border-line-light bg-surface-3 px-2.5 text-xs font-medium text-fg-2 hover:border-line-strong hover:text-fg disabled:opacity-40"
              >
                {g.name} <span className="text-fg-faint">{g.memberIds.length}</span>
              </button>
            ))}
          </div>
        )}
        <ul role="listbox" aria-multiselectable={mode === "multi"} className="mt-3 max-h-[340px] overflow-y-auto rounded-md border border-line-light">
          {visible.length === 0 && <li className="px-4 py-10 text-center text-[13px] text-fg-muted">검색 결과가 없습니다.</li>}
          {visible.map((m) => {
            const isSel = selected.includes(m.id);
            const disabled = disabledIds.includes(m.id);
            return (
              <li
                key={m.id}
                role="option"
                aria-label={`${m.name} (${m.email})`}
                aria-selected={isSel}
                aria-disabled={disabled}
                className={cn(
                  "flex items-center gap-3 border-b border-line-light px-3.5 py-2.5 last:border-b-0",
                  disabled ? "opacity-50" : "cursor-pointer hover:bg-surface-3",
                  isSel && "bg-emphasis-bg/60",
                )}
                onClick={() => !disabled && toggle(m.id)}
              >
                <span onClick={(e) => e.stopPropagation()} className="flex">
                  {mode === "single" ? (
                    <Radio checked={isSel} name="member-picker" onChange={() => !disabled && toggle(m.id)} />
                  ) : (
                    <Checkbox checked={isSel} disabled={disabled} onChange={() => toggle(m.id)} aria-label={`${m.name} 선택`} />
                  )}
                </span>
                <Avatar name={m.name} size={32} color={m.avatar_color} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-fg">
                    {m.name}
                    {m.username && <span className="ml-1.5 text-xs font-normal text-fg-faint">@{m.username}</span>}
                  </p>
                  <p className="truncate text-xs text-fg-muted">
                    {m.email}
                    {(m.department || m.position) && ` · ${[m.department, m.position].filter(Boolean).join(" ")}`}
                  </p>
                </div>
                <RoleBadge role={m.role} />
              </li>
            );
          })}
        </ul>
      </div>
    </Modal>
  );
}
