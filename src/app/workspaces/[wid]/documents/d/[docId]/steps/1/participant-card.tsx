"use client";

import { ChevronDown, Globe, GripHorizontal, LockKeyhole, MessageSquareMore, Paperclip, Trash2 } from "lucide-react";
import { useId, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from "react";

import { TextField } from "@/components/ui/input";
import { Dropdown, MenuItem } from "@/components/ui/menu";
import type { DeliveryMethod } from "@/lib/types";
import { cn, participantColor } from "@/lib/utils";

import { LOCALES, type Locale, type ParticipantInput, type PersonSuggestion } from "../../../_lib/types";

export const DELIVERY_LABEL: Record<DeliveryMethod, string> = { email: "이메일", kakao: "카카오톡", in_person: "직접 대면" };

const chipClass = "inline-flex h-8 items-center rounded-full border border-line-light bg-surface-4 px-3 text-[15px] font-medium text-fg";

function CardIconButton({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex size-8 items-center justify-center rounded-full border border-line-strong text-icon-2 transition-colors hover:bg-btn-light [&_svg]:size-4",
        active && "border-emphasis bg-emphasis-bg text-emphasis hover:bg-emphasis-bg-hover",
      )}
    >
      {children}
    </button>
  );
}

function DeliveryMenu({ value, onChange }: { value: DeliveryMethod | null; onChange: (v: DeliveryMethod) => void }) {
  return (
    <Dropdown
      panelClassName="w-[136px]"
      trigger={(open, toggle) => (
        <button type="button" onClick={toggle} aria-haspopup="menu" aria-expanded={open} className={cn(chipClass, "gap-1 hover:bg-btn-base", open && "bg-btn-base")}>
          {value ? DELIVERY_LABEL[value] : "전송 수단 선택"}
          <ChevronDown className="size-3.5" strokeWidth={2.4} />
        </button>
      )}
    >
      {(close) => (
        <>
          <MenuItem className={cn("h-8 py-0 text-sm", value === "email" && "bg-menu-hover")} onClick={() => { close(); onChange("email"); }}>
            이메일
          </MenuItem>
          <MenuItem className="h-auto py-1.5 text-sm" disabled caption="준비 중">
            카카오톡
          </MenuItem>
          <MenuItem className={cn("h-8 py-0 text-sm", value === "in_person" && "bg-menu-hover")} onClick={() => { close(); onChange("in_person"); }}>
            직접 대면
          </MenuItem>
        </>
      )}
    </Dropdown>
  );
}

function LocaleMenu({ value, onChange }: { value: Locale; onChange: (v: Locale) => void }) {
  return (
    <Dropdown
      align="right"
      panelClassName="w-36"
      trigger={(open, toggle) => (
        <button
          type="button"
          onClick={toggle}
          aria-label={`알림 언어: ${LOCALES.find((l) => l.value === value)?.label ?? value}`}
          aria-haspopup="menu"
          aria-expanded={open}
          className={cn("flex h-[30px] items-center gap-1 rounded bg-surface-4 px-2 text-[13px] font-semibold text-fg-2 hover:bg-btn-base", open && "bg-btn-base")}
        >
          <Globe className="size-3.5 text-fg-3" />
          {value}
          <ChevronDown className="size-3.5" />
        </button>
      )}
    >
      {(close) =>
        LOCALES.map((l) => (
          <MenuItem key={l.value} className={cn(l.value === value && "bg-menu-hover")} onClick={() => { close(); onChange(l.value); }}>
            {l.label} <span className="text-fg-muted">({l.value})</span>
          </MenuItem>
        ))
      }
    </Dropdown>
  );
}

/** 이름 input with autocomplete from 주소록 + workspace members. */
function NameCombobox({
  value,
  onChange,
  onPick,
  suggestions,
  setInputEl,
}: {
  value: string;
  onChange: (v: string) => void;
  onPick: (s: PersonSuggestion) => void;
  suggestions: PersonSuggestion[];
  /** callback receiving the input element (focus management) */
  setInputEl: (el: HTMLInputElement | null) => void;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const q = value.trim().toLowerCase();
  const matches = useMemo(() => {
    const list = q
      ? suggestions.filter((s) => s.name.toLowerCase().includes(q) || (s.email ?? "").toLowerCase().includes(q))
      : suggestions;
    return list.slice(0, 8);
  }, [q, suggestions]);
  const show = open && matches.length > 0;

  function choose(s: PersonSuggestion) {
    onPick(s);
    setOpen(false);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    // Korean IME: Enter/arrows while a syllable is still composing must not pick a suggestion,
    // otherwise the committed syllable is appended again after the pick.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (!show) {
      if (e.key === "ArrowDown" && matches.length) {
        setOpen(true);
        setActive(0);
        e.preventDefault();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (a + 1) % matches.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a - 1 + matches.length) % matches.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(matches[Math.min(active, matches.length - 1)]);
    } else if (e.key === "Escape") {
      e.stopPropagation();
      setOpen(false);
    }
  }

  return (
    <div className="relative w-[315px] shrink-0">
      <TextField
        ref={setInputEl}
        label="이름"
        value={value}
        maxLength={50}
        autoComplete="off"
        role="combobox"
        aria-expanded={show}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={show ? `${listId}-${active}` : undefined}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      {show && (
        <ul
          id={listId}
          role="listbox"
          aria-label="주소록 및 멤버"
          className="absolute left-0 top-full z-30 mt-1 max-h-72 w-[360px] overflow-y-auto rounded-lg border border-line-strong bg-menu py-1.5 shadow-menu"
        >
          {matches.map((s, i) => (
            <li
              key={s.key}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(s)}
              className={cn("flex cursor-pointer items-center gap-3 px-4 py-2", i === active && "bg-menu-hover")}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-fg">{s.name}</span>
                <span className="block truncate text-xs text-fg-muted">
                  {[s.email, s.sub].filter(Boolean).join(" · ") || "연락처 정보 없음"}
                </span>
              </span>
              <span className="shrink-0 rounded border border-line-strong px-1.5 py-px text-[11px] text-fg-muted">
                {s.source === "member" ? "멤버" : "주소록"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export interface ParticipantCardProps {
  index: number;
  participant: ParticipantInput;
  who: "서명자" | "열람자";
  sequential: boolean;
  isView: boolean;
  canDelete: boolean;
  emailError: string | null;
  suggestions: PersonSuggestion[];
  onChange: (patch: Partial<ParticipantInput>) => void;
  onDelete: () => void;
  onOpenAuth: () => void;
  onOpenMessage: () => void;
  onMove: (dir: -1 | 1) => void;
  setNameEl: (el: HTMLInputElement | null) => void;
  setCardEl: (el: HTMLDivElement | null) => void;
  dragging: boolean;
  dropTarget: boolean;
  onHandleDragStart: (e: DragEvent<HTMLButtonElement>) => void;
  onDragEnd: () => void;
  onDragOver: (e: DragEvent<HTMLDivElement>) => void;
  onDrop: (e: DragEvent<HTMLDivElement>) => void;
}

export function ParticipantCard({
  index,
  participant: p,
  who,
  sequential,
  isView,
  canDelete,
  emailError,
  suggestions,
  onChange,
  onDelete,
  onOpenAuth,
  onOpenMessage,
  onMove,
  setNameEl,
  setCardEl,
  dragging,
  dropTarget,
  onHandleDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: ParticipantCardProps) {
  const color = participantColor(index);
  const emailRef = useRef<HTMLInputElement>(null);
  const [emailTouched, setEmailTouched] = useState(false);
  // only format / duplicate problems are shown inline; an empty field just keeps 다음으로 disabled
  const showEmailError = emailTouched && !!emailError && p.email.trim() !== "";
  const label = p.roleLabel?.trim() ? p.roleLabel.trim() : sequential ? `${who} ${index + 1}` : who;

  return (
    <div
      ref={setCardEl}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={cn(
        "relative rounded-xl border border-line-strong bg-surface pb-8 pl-[37px] pr-[18px] pt-[39px] transition-[opacity,border-color]",
        dragging && "opacity-50",
        dropTarget && "border-emphasis",
      )}
      aria-label={`${label} ${p.name}`.trim()}
      role="group"
    >
      <span className="absolute inset-y-0 left-0 w-1.5 rounded-l-xl" style={{ background: color }} aria-hidden />

      {sequential && (
        <button
          type="button"
          draggable
          onDragStart={onHandleDragStart}
          onDragEnd={onDragEnd}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp") {
              e.preventDefault();
              onMove(-1);
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              onMove(1);
            }
          }}
          aria-label={`${label} 순서 변경 (위·아래 화살표 키)`}
          title="드래그해서 순서 변경"
          className="absolute left-1/2 top-1.5 flex h-5 w-9 -translate-x-1/2 cursor-grab items-center justify-center rounded text-line-strong hover:text-fg-muted active:cursor-grabbing"
        >
          <GripHorizontal className="size-5" />
        </button>
      )}

      <div className="absolute right-[18px] top-[17px] flex gap-[15px]">
        <CardIconButton label={p.authPassword ? "인증 설정 (비밀번호 설정됨)" : "인증 설정"} active={!!p.authPassword} onClick={onOpenAuth}>
          <LockKeyhole />
        </CardIconButton>
        <CardIconButton label={p.message ? "남길 말 (작성됨)" : "남길 말"} active={!!p.message} onClick={onOpenMessage}>
          <MessageSquareMore />
        </CardIconButton>
        {!isView && (
          <CardIconButton
            label={p.requestAttachment ? "첨부 요청 해제" : "첨부 요청"}
            active={p.requestAttachment}
            onClick={() => onChange({ requestAttachment: !p.requestAttachment })}
          >
            <Paperclip />
          </CardIconButton>
        )}
        {canDelete && (
          <CardIconButton label="삭제" onClick={onDelete}>
            <Trash2 />
          </CardIconButton>
        )}
      </div>

      <div className="flex items-center gap-3">
        <span className={chipClass}>{label}</span>
        <DeliveryMenu
          value={p.delivery}
          onChange={(delivery) => {
            onChange({ delivery });
            if (delivery === "email") requestAnimationFrame(() => emailRef.current?.focus());
          }}
        />
        {p.requestAttachment && !isView && <span className="text-[13px] text-emphasis">첨부파일 요청</span>}
      </div>

      <div className="mt-[23px] flex items-start gap-[18px] pr-3.5">
        <NameCombobox
          value={p.name}
          suggestions={suggestions}
          setInputEl={setNameEl}
          onChange={(name) => onChange({ name })}
          onPick={(s) =>
            onChange({
              name: s.name,
              ...(s.email && p.delivery !== "in_person" ? { email: s.email, delivery: "email" as const } : {}),
            })
          }
        />
        {p.delivery === "email" && (
          <div className="min-w-0 flex-1">
            <TextField
              ref={emailRef}
              label="이메일"
              type="email"
              inputMode="email"
              autoComplete="off"
              value={p.email}
              maxLength={254}
              invalid={showEmailError}
              aria-invalid={showEmailError}
              onChange={(e) => onChange({ email: e.target.value })}
              onBlur={() => setEmailTouched(true)}
              right={<LocaleMenu value={p.locale} onChange={(locale) => onChange({ locale })} />}
            />
            {showEmailError && <p className="mt-1 pl-1 text-xs text-negative">{emailError}</p>}
          </div>
        )}
        {p.delivery === "in_person" && (
          <p className="self-center text-[13px] leading-relaxed text-fg-muted">
            직접 대면 서명은 요청자 기기에서 서명자가 바로 서명합니다.
            <br />
            서명 요청 메일은 발송되지 않습니다.
          </p>
        )}
      </div>
    </div>
  );
}
