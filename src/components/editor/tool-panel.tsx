"use client";

import {
  Building2,
  Calendar,
  Check,
  ChevronDown,
  ChevronUp,
  List,
  LoaderCircle,
  MapPin,
  Settings,
  SquareCheck,
  Type,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { toast } from "sonner";

import { Dropdown, MenuItem } from "@/components/ui/menu";
import { Segmented } from "@/components/ui/tabs";
import { FIELD_META, FIELD_ORDER } from "@/lib/fields";
import { cn, participantColor, withAlpha } from "@/lib/utils";

import {
  AUTO_FILL_META,
  SIGN_MODE_LABELS,
  type ArmedTool,
  type AutoFillKind,
  type EditorCustomField,
  type EditorParticipant,
  type SignMode,
  type ToolSpec,
} from "./editor-model";
import { SIGN_MODE_ICONS } from "./field-box";

const CUSTOM_ICONS: Record<EditorCustomField["type"], LucideIcon> = {
  text: Type,
  number: Type,
  date: Calendar,
  checkbox: SquareCheck,
  dropdown: List,
};

const AUTO_ICONS: Record<AutoFillKind, LucideIcon> = { name: UserRound, company: Building2, address: MapPin };

/**
 * Arms a tool for a participant. `e` is the pointer-down event (enables drag-to-page) or null for
 * keyboard / menu activation. Re-activating the armed tool disarms it unless `force` is set.
 */
export type ToolActivate = (
  tool: ToolSpec,
  participantKey: string,
  e: ReactPointerEvent<HTMLElement> | null,
  opts?: { force?: boolean },
) => void;

function sameTool(a: ToolSpec, b: ToolSpec) {
  if (a.kind !== b.kind) return false;
  if (a.kind === "basic" && b.kind === "basic") return a.type === b.type;
  if (a.kind === "auto" && b.kind === "auto") return a.autoFill === b.autoFill;
  if (a.kind === "custom" && b.kind === "custom") return a.custom.id === b.custom.id;
  return false;
}

/** Tool button: arms on pointer down (so it can also be dragged onto a page); Enter/Space arms via keyboard. */
function ToolButton({
  icon: Icon,
  label,
  active,
  onActivate,
  badge,
  className,
}: {
  icon: LucideIcon;
  label: ReactNode;
  active: boolean;
  onActivate: (e: ReactPointerEvent<HTMLElement> | null) => void;
  badge?: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        onActivate(e);
      }}
      onClick={(e: ReactMouseEvent) => {
        // keyboard activation (Enter / Space) produces a click with detail 0
        if (e.detail === 0) onActivate(null);
      }}
      className={cn(
        "flex h-9 w-full items-center gap-2 rounded border bg-surface px-3 text-left text-sm font-medium text-fg-2 transition-colors",
        active ? "border-emphasis bg-emphasis-bg text-fg" : "border-line-strong hover:bg-surface-3",
        className,
      )}
    >
      <Icon className="size-4 shrink-0 text-icon-2" strokeWidth={2} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge}
    </button>
  );
}

function SignatureSplitButton({
  participantKey,
  armed,
  onActivate,
}: {
  participantKey: string;
  armed: ArmedTool | null;
  onActivate: ToolActivate;
}) {
  const [mode, setMode] = useState<SignMode>("any");
  const active = !!armed && armed.participantKey === participantKey && armed.tool.kind === "basic" && armed.tool.type === "signature";
  const Icon = SIGN_MODE_ICONS[mode];
  return (
    <div
      className={cn(
        "flex h-9 w-full items-stretch rounded border bg-surface text-sm font-medium text-fg-2 transition-colors",
        active ? "border-emphasis bg-emphasis-bg text-fg" : "border-line-strong",
      )}
    >
      <button
        type="button"
        aria-pressed={active}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          onActivate({ kind: "basic", type: "signature", signMode: mode }, participantKey, e);
        }}
        onClick={(e) => {
          if (e.detail === 0) onActivate({ kind: "basic", type: "signature", signMode: mode }, participantKey, null);
        }}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-l px-3 text-left hover:bg-surface-3"
      >
        <Icon className="size-4 shrink-0 text-icon-2" strokeWidth={2.2} />
        <span className="truncate">{SIGN_MODE_LABELS[mode]}</span>
      </button>
      <span className={cn("w-px", active ? "bg-emphasis" : "bg-line-strong")} />
      <Dropdown
        align="right"
        panelClassName="w-[176px]"
        offset={4}
        trigger={(open, toggle) => (
          <button
            type="button"
            aria-label="서명 방식 선택"
            aria-expanded={open}
            onClick={toggle}
            className={cn("flex w-9 items-center justify-center rounded-r hover:bg-surface-3", open && "bg-surface-3")}
          >
            <ChevronDown className="size-4 text-icon-2" />
          </button>
        )}
      >
        {(close) =>
          (Object.keys(SIGN_MODE_LABELS) as SignMode[]).map((m) => {
            const MIcon = SIGN_MODE_ICONS[m];
            return (
              <MenuItem
                key={m}
                icon={<MIcon />}
                onClick={() => {
                  setMode(m);
                  close();
                  onActivate({ kind: "basic", type: "signature", signMode: m }, participantKey, null, { force: true });
                }}
              >
                <span className="flex items-center justify-between">
                  {SIGN_MODE_LABELS[m]}
                  {m === mode && <Check className="size-3.5 text-emphasis" strokeWidth={3} />}
                </span>
              </MenuItem>
            );
          })
        }
      </Dropdown>
    </div>
  );
}

function ParticipantCard({
  participant,
  count,
  expanded,
  onToggle,
  armed,
  onActivate,
  customFields,
  customFieldsHref,
  onNeedCustomFields,
}: {
  participant: EditorParticipant;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  armed: ArmedTool | null;
  onActivate: ToolActivate;
  customFields: EditorCustomField[] | null;
  customFieldsHref: string | null;
  onNeedCustomFields: () => void;
}) {
  const [tab, setTab] = useState<"basic" | "auto">("basic");
  const color = participantColor(participant.colorIndex);
  const isActive = (tool: ToolSpec) => !!armed && armed.participantKey === participant.key && sameTool(armed.tool, tool);
  const activate = (tool: ToolSpec) => (e: ReactPointerEvent<HTMLElement> | null) => onActivate(tool, participant.key, e);

  return (
    <section className={cn("rounded-md border border-line bg-surface px-3 py-4", expanded && "shadow-card")}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="relative flex h-9 w-full items-center gap-2 overflow-hidden rounded pl-3 pr-2 text-left"
        style={{ background: withAlpha(color, 0.24) }}
      >
        {expanded && <span aria-hidden className="absolute inset-y-0 left-0 w-1" style={{ background: color }} />}
        <span className="min-w-0 flex-1 truncate text-sm font-bold text-fg">{participant.name || "이름 없음"}</span>
        {count > 0 && (
          <span
            className="flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-bold text-fg-reversed"
            style={{ background: color }}
            aria-label={`입력란 ${count}개`}
          >
            {count}
          </span>
        )}
        {expanded ? <ChevronUp className="size-4 shrink-0 text-icon-2" /> : <ChevronDown className="size-4 shrink-0 text-icon-2" />}
      </button>

      {expanded && (
        <>
          <Segmented
            size="sm"
            className="mt-3 flex w-full"
            value={tab}
            onChange={(v) => {
              setTab(v);
              if (v === "auto") onNeedCustomFields();
            }}
            options={[
              { value: "basic", label: "기본" },
              { value: "auto", label: "자동 입력" },
            ]}
          />
          {tab === "basic" ? (
            <div className="mt-3 flex flex-col gap-1.5">
              {FIELD_ORDER.map((type) =>
                type === "signature" ? (
                  <SignatureSplitButton key={type} participantKey={participant.key} armed={armed} onActivate={onActivate} />
                ) : (
                  <ToolButton
                    key={type}
                    icon={FIELD_META[type].icon}
                    label={FIELD_META[type].label}
                    active={isActive({ kind: "basic", type })}
                    onActivate={activate({ kind: "basic", type })}
                  />
                ),
              )}
            </div>
          ) : (
            <div className="mt-3 flex flex-col gap-1.5">
              {(Object.keys(AUTO_FILL_META) as AutoFillKind[]).map((k) => (
                <ToolButton
                  key={k}
                  icon={AUTO_ICONS[k]}
                  label={AUTO_FILL_META[k].label}
                  active={isActive({ kind: "auto", autoFill: k })}
                  onActivate={activate({ kind: "auto", autoFill: k })}
                  badge={
                    k === "address" ? (
                      <span className="rounded-full border border-warning-border bg-warning-bg px-1.5 text-[10px] font-bold leading-4 text-warning">
                        New
                      </span>
                    ) : undefined
                  }
                />
              ))}

              <p className="mt-3 px-0.5 text-xs font-medium text-fg-muted">맞춤 입력란</p>
              {customFields === null ? (
                <p className="flex items-center gap-1.5 px-0.5 py-2 text-xs text-fg-muted">
                  <LoaderCircle className="size-3.5 animate-spin" /> 불러오는 중…
                </p>
              ) : customFields.length === 0 ? (
                <p className="px-0.5 py-1 text-xs leading-relaxed text-fg-disabled">등록된 맞춤 입력란이 없습니다.</p>
              ) : (
                customFields.map((cf) => (
                  <ToolButton
                    key={cf.id}
                    icon={CUSTOM_ICONS[cf.type] ?? Type}
                    label={cf.name}
                    active={isActive({ kind: "custom", custom: cf })}
                    onActivate={activate({ kind: "custom", custom: cf })}
                  />
                ))
              )}
              {customFieldsHref && (
                <Link
                  href={customFieldsHref}
                  target="_blank"
                  rel="noopener"
                  className="mt-1 flex h-8 items-center gap-1.5 rounded px-1 text-[13px] font-medium text-fg-muted hover:bg-surface-3 hover:text-fg-2"
                >
                  <Settings className="size-3.5" />
                  맞춤 입력란 설정
                </Link>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** Left panel (240px): 문서 편집 + one accordion card per participant with the field tools. */
export function ToolPanel({
  participants,
  counts,
  expandedKey,
  onToggle,
  armed,
  onActivate,
  customFields,
  customFieldsHref,
  onNeedCustomFields,
}: {
  participants: EditorParticipant[];
  counts: Record<string, number>;
  expandedKey: string | null;
  onToggle: (key: string) => void;
  armed: ArmedTool | null;
  onActivate: ToolActivate;
  customFields: EditorCustomField[] | null;
  customFieldsHref: string | null;
  onNeedCustomFields: () => void;
}) {
  const soon = () => toast("준비 중인 기능입니다.");
  return (
    <aside
      aria-label="입력란 도구"
      className="flex w-[240px] shrink-0 flex-col gap-4 overflow-y-auto border-r border-line bg-surface-2 p-4"
    >
      <section className="rounded-md border border-line bg-surface px-3 py-4">
        <Dropdown
          className="flex w-full"
          panelClassName="w-full"
          offset={4}
          trigger={(open, toggle) => (
            <button
              type="button"
              onClick={toggle}
              aria-expanded={open}
              className="flex h-9 w-full items-center justify-between rounded px-3 text-sm font-bold text-fg hover:bg-surface-3"
            >
              문서 편집
              <ChevronDown className={cn("size-4 text-icon-2 transition-transform", open && "rotate-180")} />
            </button>
          )}
        >
          {(close) => (
            <>
              <MenuItem onClick={() => { close(); soon(); }}>페이지 회전</MenuItem>
              <MenuItem onClick={() => { close(); soon(); }}>페이지 삭제</MenuItem>
              <MenuItem onClick={() => { close(); soon(); }}>문서 추가</MenuItem>
            </>
          )}
        </Dropdown>
      </section>

      {participants.length === 0 ? (
        <p className="rounded-md border border-line bg-surface px-3 py-6 text-center text-[13px] text-fg-muted">
          참여자가 없습니다.
        </p>
      ) : (
        participants.map((p) => (
          <ParticipantCard
            key={p.key}
            participant={p}
            count={counts[p.key] ?? 0}
            expanded={expandedKey === p.key}
            onToggle={() => onToggle(p.key)}
            armed={armed}
            onActivate={onActivate}
            customFields={customFields}
            customFieldsHref={customFieldsHref}
            onNeedCustomFields={onNeedCustomFields}
          />
        ))
      )}
    </aside>
  );
}
