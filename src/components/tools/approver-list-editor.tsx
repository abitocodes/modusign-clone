"use client";

import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";

import { Select } from "@/components/ui/input";
import { APPROVER_LIMIT, memberLabel, type MemberOption } from "@/lib/tools/approvals";
import { cn } from "@/lib/utils";

/**
 * Ordered approver rows: 순서 번호 · 멤버 선택 · ↑ ↓ · 삭제, plus "+ 결재자 추가".
 * `value` holds user ids in approval order ("" = row without a selection yet).
 */
export function ApproverListEditor({
  members,
  value,
  onChange,
  excludeIds = [],
  max = APPROVER_LIMIT,
  disabled,
  invalid,
  idPrefix = "approver",
  fallbackLabels = {},
}: {
  members: MemberOption[];
  value: string[];
  onChange: (ids: string[]) => void;
  excludeIds?: string[];
  max?: number;
  disabled?: boolean;
  invalid?: boolean;
  idPrefix?: string;
  /** names saved with the line, shown for ids that are no longer workspace members */
  fallbackLabels?: Record<string, string>;
}) {
  const available = members.filter((m) => !excludeIds.includes(m.id));
  const known = new Set(members.map((m) => m.id));

  const update = (i: number, id: string) => onChange(value.map((v, j) => (j === i ? id : v)));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= value.length) return;
    const next = [...value];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const remove = (i: number) => onChange(value.filter((_, j) => j !== i));

  const canAdd = !disabled && value.length < max && value.length < available.length;
  const iconBtn =
    "flex size-8 shrink-0 items-center justify-center rounded text-fg-faint transition-colors hover:bg-btn-light hover:text-fg-2 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-fg-faint";

  return (
    <div>
      {value.length === 0 ? (
        <p className={cn("rounded border border-dashed border-line-strong px-3 py-3 text-[13px] text-fg-muted", invalid && "border-negative")}>
          {available.length === 0
            ? "결재자로 지정할 수 있는 다른 멤버가 없습니다. 통합 설정 > 멤버에서 멤버를 추가해 주세요."
            : "결재자를 추가해 주세요. 결재는 지정한 순서대로 진행됩니다."}
        </p>
      ) : (
        <ol className="space-y-2">
          {value.map((id, i) => {
            const options = available.filter((m) => m.id === id || !value.includes(m.id));
            return (
              <li key={`${i}-${id || "empty"}`} className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="flex size-6 shrink-0 items-center justify-center rounded-full border border-line-strong bg-surface-4 text-xs font-bold text-fg-2"
                >
                  {i + 1}
                </span>
                <Select
                  id={`${idPrefix}-${i}`}
                  aria-label={`${i + 1}번째 결재자`}
                  value={id}
                  disabled={disabled}
                  onChange={(e) => update(i, e.target.value)}
                  wrapperClassName="min-w-0 flex-1"
                  className={cn("truncate", invalid && !id && "border-negative")}
                >
                  <option value="" disabled>
                    결재자 선택
                  </option>
                  {options.map((m) => (
                    <option key={m.id} value={m.id}>
                      {memberLabel(m)}
                    </option>
                  ))}
                  {id && !known.has(id) && (
                    <option value={id}>{fallbackLabels[id] ? `${fallbackLabels[id]} (워크스페이스에 없는 멤버)` : "워크스페이스에 없는 멤버"}</option>
                  )}
                </Select>
                <button type="button" aria-label={`${i + 1}번째 결재자 위로`} className={iconBtn} disabled={disabled || i === 0} onClick={() => move(i, -1)}>
                  <ArrowUp className="size-4" />
                </button>
                <button
                  type="button"
                  aria-label={`${i + 1}번째 결재자 아래로`}
                  className={iconBtn}
                  disabled={disabled || i === value.length - 1}
                  onClick={() => move(i, 1)}
                >
                  <ArrowDown className="size-4" />
                </button>
                <button type="button" aria-label={`${i + 1}번째 결재자 삭제`} className={iconBtn} disabled={disabled} onClick={() => remove(i)}>
                  <X className="size-4" />
                </button>
              </li>
            );
          })}
        </ol>
      )}
      {!disabled && (
        <button
          type="button"
          disabled={!canAdd}
          onClick={() => onChange([...value, ""])}
          className="mt-2.5 flex h-8 items-center gap-1 rounded px-2 text-[13px] font-medium text-emphasis hover:bg-emphasis-bg disabled:text-fg-disabled disabled:hover:bg-transparent"
        >
          <Plus className="size-4" />
          결재자 추가
          <span className="ml-1 text-xs font-normal text-fg-muted">
            ({value.length}/{Math.min(max, Math.max(available.length, value.length))})
          </span>
        </button>
      )}
    </div>
  );
}
