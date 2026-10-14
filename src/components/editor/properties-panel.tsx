"use client";

import { ChevronDown, ChevronUp, Info, Plus, Trash2, X } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Checkbox, Radio } from "@/components/ui/controls";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Dropdown, MenuItem } from "@/components/ui/menu";
import { FIELD_META } from "@/lib/fields";
import { cn, participantColor, withAlpha } from "@/lib/utils";

import {
  AUTO_FILL_META,
  DEFAULT_FONT_SIZE,
  FORMAT_LABELS,
  MAX_DROPDOWN_ITEMS,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  SIGN_MODE_LABELS,
  TEXT_LIKE,
  fieldTitle,
  type EditorField,
  type EditorParticipant,
  type FieldOptions,
  type SignMode,
} from "./editor-model";
import { SIGN_MODE_ICONS } from "./field-box";

export type PatchField = (patch: Partial<Omit<EditorField, "id" | "options">>, coalesceKey?: string) => void;
export type PatchOptions = (patch: Partial<FieldOptions>, coalesceKey?: string) => void;

const FONT_SIZES = Array.from({ length: MAX_FONT_SIZE - MIN_FONT_SIZE + 1 }, (_, i) => MIN_FONT_SIZE + i);

function Section({
  title,
  badge,
  defaultOpen = false,
  children,
}: {
  title: ReactNode;
  badge?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-b border-line-light">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-12 w-full items-center gap-2 px-4 text-left text-sm font-medium text-fg-2 hover:bg-surface-3"
      >
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {badge}
        {open ? <ChevronUp className="size-4 shrink-0 text-icon-2" /> : <ChevronDown className="size-4 shrink-0 text-icon-2" />}
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </section>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex h-12 items-center gap-2 border-b border-line-light px-4">
      <span onClick={() => onChange(!checked)} className="min-w-0 flex-1 cursor-pointer select-none truncate text-sm font-medium text-fg-2">
        {label}
      </span>
      <Checkbox aria-label={label} checked={checked} onChange={onChange} />
    </div>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return <p className="mt-2 text-xs leading-relaxed text-fg-muted">{children}</p>;
}

function NewBadge() {
  return (
    <span className="rounded-full border border-warning-border bg-warning-bg px-1.5 text-[10px] font-bold leading-4 text-warning">NEW</span>
  );
}

function ParticipantSelect({
  value,
  participants,
  onChange,
}: {
  value: string;
  participants: EditorParticipant[];
  onChange: (key: string) => void;
}) {
  const current = participants.find((p) => p.key === value);
  return (
    <Dropdown
      className="flex w-full"
      panelClassName="w-full max-h-64 overflow-y-auto"
      offset={4}
      trigger={(open, toggle) => (
        <button
          type="button"
          onClick={toggle}
          aria-haspopup="listbox"
          aria-expanded={open}
          className={cn(
            "flex h-9 w-full items-center gap-2 rounded border border-line bg-surface px-3 text-left text-sm text-fg shadow-input",
            open && "border-emphasis",
          )}
        >
          <span
            aria-hidden
            className="size-2.5 shrink-0 rounded-[2px]"
            style={{ background: current ? participantColor(current.colorIndex) : "transparent" }}
          />
          <span className="min-w-0 flex-1 truncate">{current?.name || "참여자 선택"}</span>
          <svg width="10" height="6" viewBox="0 0 10 6" aria-hidden className="shrink-0 fill-icon-2">
            <path d="M0 0h10L5 6z" />
          </svg>
        </button>
      )}
    >
      {(close) =>
        participants.map((p) => (
          <MenuItem
            key={p.key}
            onClick={() => {
              close();
              if (p.key !== value) onChange(p.key);
            }}
            className={cn(p.key === value && "bg-menu-hover")}
            icon={<span className="block size-2.5 rounded-[2px]" style={{ background: participantColor(p.colorIndex) }} />}
          >
            {p.name || "이름 없음"}
          </MenuItem>
        ))
      }
    </Dropdown>
  );
}

function SignModeBox({ field, onOptions }: { field: EditorField; onOptions: PatchOptions }) {
  const mode: SignMode = field.options.signMode ?? "any";
  const row = (m: SignMode) => {
    const Icon = SIGN_MODE_ICONS[m];
    const checked = mode === m;
    return (
      <div
        onClick={() => onOptions({ signMode: m })}
        className={cn("flex h-[52px] cursor-pointer select-none items-center gap-2 px-4", m !== "any" && "border-t border-line")}
      >
        <Icon className={cn("size-4 shrink-0", checked ? "text-icon-2" : "text-fg-disabled")} strokeWidth={2.2} />
        <span className={cn("min-w-0 flex-1 text-[13px] font-medium", checked ? "text-fg" : "text-fg-muted")}>{SIGN_MODE_LABELS[m]}</span>
        {/* the radio handles its own clicks (change event); keep them from re-triggering the row */}
        <span onClick={(e) => e.stopPropagation()} className="inline-flex">
          <Radio
            name={`sign-mode-${field.id}`}
            checked={checked}
            onChange={() => onOptions({ signMode: m })}
            className="gap-0"
            label={<span className="sr-only">{SIGN_MODE_LABELS[m]}</span>}
          />
        </span>
      </div>
    );
  };
  const sub = (caption: string, label: string, checked: boolean, onChange: (v: boolean) => void) => (
    <div className="flex items-center gap-2">
      <span onClick={() => onChange(!checked)} className="min-w-0 flex-1 cursor-pointer select-none">
        <span className="block text-[11px] text-fg-muted">{caption}</span>
        <span className="block text-[13px] font-bold text-fg-2">{label}</span>
      </span>
      <Checkbox aria-label={`${caption} ${label}`} checked={checked} onChange={onChange} />
    </div>
  );
  const drawOnly = sub("사인", "직접 그리기로만 제한", !!field.options.drawOnly, (v) => onOptions({ drawOnly: v }));
  const uploadOnly = sub("도장", "이미지 업로드로만 제한", !!field.options.uploadOnly, (v) => onOptions({ uploadOnly: v }));
  return (
    <div className="overflow-hidden rounded border border-line">
      {row("any")}
      {mode === "any" && (
        <div className="space-y-3 border-t border-line bg-surface-3 px-4 py-3">
          {drawOnly}
          {uploadOnly}
        </div>
      )}
      {row("sign")}
      {mode === "sign" && <div className="border-t border-line bg-surface-3 px-4 py-3">{drawOnly}</div>}
      {row("stamp")}
      {mode === "stamp" && <div className="border-t border-line bg-surface-3 px-4 py-3">{uploadOnly}</div>}
    </div>
  );
}

function DropdownItemsEditor({ field, onOptions }: { field: EditorField; onOptions: PatchOptions }) {
  const items = field.options.items ?? [];
  const set = (next: string[], key?: string) => onOptions({ items: next }, key);
  return (
    <div className="space-y-1.5">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-1">
          <Input
            aria-label={`항목 ${i + 1}`}
            value={item}
            maxLength={100}
            placeholder={`항목 ${i + 1}`}
            onChange={(e) => set(items.map((v, j) => (j === i ? e.target.value : v)), `items:${field.id}:${i}`)}
            className="h-8 text-[13px]"
          />
          <button
            type="button"
            aria-label={`항목 ${i + 1} 삭제`}
            disabled={items.length <= 1}
            onClick={() => set(items.filter((_, j) => j !== i))}
            className="flex size-8 shrink-0 items-center justify-center rounded text-icon-2 hover:bg-btn-light disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
      <button
        type="button"
        disabled={items.length >= MAX_DROPDOWN_ITEMS}
        onClick={() => set([...items, `항목 ${items.length + 1}`])}
        className="mt-1 flex h-8 w-full items-center justify-center gap-1 rounded border border-line-strong bg-btn-light text-[13px] font-medium text-fg-2 hover:bg-btn-base disabled:opacity-40"
      >
        <Plus className="size-3.5" /> 항목 추가
      </button>
    </div>
  );
}

/** Right panel content while a field is selected. Remount per field (key={field.id}). */
export function PropertiesPanel({
  field,
  participants,
  onPatch,
  onOptions,
  onDelete,
}: {
  field: EditorField;
  participants: EditorParticipant[];
  onPatch: PatchField;
  onOptions: PatchOptions;
  onDelete: () => void;
}) {
  const owner = participants.find((p) => p.key === field.participantKey);
  const color = participantColor(owner?.colorIndex ?? 0);
  const Icon = field.type === "signature" ? SIGN_MODE_ICONS[field.options.signMode ?? "any"] : FIELD_META[field.type].icon;
  const o = field.options;
  const textLike = TEXT_LIKE.includes(field.type);
  const k = (name: string) => `${name}:${field.id}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className="flex h-[55px] shrink-0 items-center gap-2 border-b border-line-light pl-4 pr-2"
        style={{ background: withAlpha(color, 0.08) }}
      >
        <Icon className="size-4 shrink-0 text-icon-2" strokeWidth={2.2} />
        <h2 className="min-w-0 flex-1 truncate text-sm font-bold text-fg">{fieldTitle(field)}</h2>
        <button
          type="button"
          aria-label="입력란 삭제"
          title="삭제 (Delete)"
          onClick={onDelete}
          className="flex size-8 items-center justify-center rounded text-icon-2 hover:bg-btn-light"
        >
          <Trash2 className="size-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <Section title="서명자" defaultOpen>
          <ParticipantSelect
            value={field.participantKey}
            participants={participants}
            onChange={(participantKey) => onPatch({ participantKey })}
          />
        </Section>

        {o.autoFill && (
          <div className="flex gap-2 border-b border-line-light px-4 py-3 text-xs leading-relaxed text-fg-muted">
            <Info className="mt-px size-3.5 shrink-0" />
            <span>
              자동 입력 · {AUTO_FILL_META[o.autoFill].label}
              <br />
              {o.autoFill === "name" ? "서명자의 이름이 미리 입력됩니다." : "서명자가 직접 입력하며, 데이터로 수집됩니다."}
            </span>
          </div>
        )}

        {field.type === "signature" && (
          <>
            <Section title="서명 방식" defaultOpen>
              <SignModeBox field={field} onOptions={onOptions} />
              <div className="mt-3">
                <Checkbox
                  checked={!!o.resizable}
                  onChange={(v) => onOptions({ resizable: v })}
                  label={<span className="text-[13px] font-bold text-fg-2">서명자가 크기 조절</span>}
                />
              </div>
            </Section>
            <ToggleRow label="한 번에 서명 허용" checked={!!o.batchSign} onChange={(v) => onOptions({ batchSign: v })} />
          </>
        )}

        {field.type === "signed_date" && (
          <div className="flex gap-2 border-b border-line-light px-4 py-3 text-xs leading-relaxed text-fg-muted">
            <Info className="mt-px size-3.5 shrink-0" />
            <span>서명자가 서명한 날짜가 YYYY-MM-DD 형식으로 자동 입력됩니다.</span>
          </div>
        )}

        {field.type === "checkbox" && (
          <ToggleRow label="체크 필수" checked={field.required} onChange={(v) => onPatch({ required: v })} />
        )}

        {field.type !== "checkbox" && field.type !== "signed_date" && field.type !== "signature" && (
          <ToggleRow label="필수 입력" checked={field.required} onChange={(v) => onPatch({ required: v })} />
        )}

        {field.type === "transcribe" && (
          <Section title="따라쓰기 문장" defaultOpen>
            <Textarea
              aria-label="따라쓰기 문장"
              rows={3}
              maxLength={200}
              value={o.sentence ?? ""}
              placeholder="서명자가 따라 쓸 문장을 입력하세요."
              onChange={(e) => onOptions({ sentence: e.target.value }, k("sentence"))}
              className="h-[92px] text-[13px]"
            />
            <Hint>예) 위 내용을 모두 확인하였으며 이에 동의합니다.</Hint>
          </Section>
        )}

        {field.type === "dropdown" && (
          <Section title="드롭다운 항목" defaultOpen>
            <DropdownItemsEditor field={field} onOptions={onOptions} />
          </Section>
        )}

        {textLike && (
          <Section title="스타일">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[13px] text-fg-2">글자 크기</span>
              <Select
                aria-label="글자 크기"
                wrapperClassName="w-[104px]"
                value={o.fontSize ?? DEFAULT_FONT_SIZE}
                onChange={(e) => onOptions({ fontSize: Number(e.target.value) })}
                className="h-8 text-[13px]"
              >
                {FONT_SIZES.map((s) => (
                  <option key={s} value={s}>
                    {s}pt
                  </option>
                ))}
              </Select>
            </div>
          </Section>
        )}

        {field.type === "text" && (
          <Section title="입력 형식">
            <div className="flex flex-col gap-2.5">
              {(Object.keys(FORMAT_LABELS) as NonNullable<FieldOptions["format"]>[]).map((f) => (
                <Radio
                  key={f}
                  name={`format-${field.id}`}
                  checked={(o.format ?? "free") === f}
                  onChange={() => onOptions({ format: f })}
                  label={<span className="text-[13px] font-medium text-fg-2">{FORMAT_LABELS[f]}</span>}
                />
              ))}
            </div>
          </Section>
        )}

        {field.type === "text" && !o.autoFill && (
          <Section title="기본 텍스트" badge={<NewBadge />} defaultOpen>
            <Textarea
              aria-label="기본 텍스트"
              rows={4}
              maxLength={500}
              value={o.defaultText ?? ""}
              onChange={(e) => onOptions({ defaultText: e.target.value }, k("defaultText"))}
              className="h-[92px] text-[13px]"
            />
            <Hint>서명자에게 미리 입력되어 보이며, 서명자가 수정할 수 있습니다.</Hint>
          </Section>
        )}

        {(field.type === "text" || field.type === "date" || field.type === "dropdown" || field.type === "transcribe") && (
          <Section title="입력 가이드">
            <Input
              aria-label="입력 가이드"
              value={o.placeholder ?? ""}
              maxLength={100}
              placeholder="예) 이름을 입력하세요."
              onChange={(e) => onOptions({ placeholder: e.target.value }, k("placeholder"))}
              className="text-[13px]"
            />
            <Hint>입력란이 비어 있을 때 서명자에게 보이는 안내 문구입니다.</Hint>
          </Section>
        )}

        <Section title="데이터 라벨">
          <Input
            aria-label="데이터 라벨"
            value={o.label ?? ""}
            maxLength={50}
            placeholder="데이터 라벨 입력"
            onChange={(e) => onOptions({ label: e.target.value }, k("label"))}
            className="text-[13px]"
          />
          <Hint>데이터 내보내기에서 이 입력란의 항목 이름으로 사용됩니다.</Hint>
        </Section>
      </div>
    </div>
  );
}
