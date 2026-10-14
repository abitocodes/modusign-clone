"use client";

import { CircleAlert, Plus, Trash2, X } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Checkbox } from "@/components/ui/controls";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import type { DeliveryMethod, DocumentCc, Label } from "@/lib/types";
import { cn, PARTICIPANT_COLORS } from "@/lib/utils";

import { EMAIL_RE, MAX_CC } from "../../../_lib/types";
import { createLabel } from "./actions";

/* ----------------------------------------------------------- primitives */

function CloseButton({ onClick, className }: { onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      aria-label="닫기"
      onClick={onClick}
      className={cn("absolute right-4 top-4 flex size-8 items-center justify-center rounded text-icon-2 hover:bg-btn-light", className)}
    >
      <X className="size-5" />
    </button>
  );
}

const noop = () => {};

const primaryBtn =
  "h-10 rounded-md bg-primary px-[22px] text-sm font-semibold text-primary-fg shadow-button hover:bg-primary-hover disabled:bg-btn-disabled disabled:text-fg-disabled disabled:shadow-none";
const ghostBtn = "h-10 rounded-md bg-btn-light px-4 text-sm font-medium text-fg-2 hover:bg-btn-base disabled:opacity-60";

function DialogFrame({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer: ReactNode }) {
  return (
    <div className="relative p-[30px]">
      <CloseButton onClick={onClose} />
      <h2 className="pr-8 text-lg font-bold text-fg">{title}</h2>
      {children}
      <div className="mt-7 flex justify-end gap-2">{footer}</div>
    </div>
  );
}

/* -------------------------------------------------------- 라벨 미설정 */

export function LabelWarningModal({
  open,
  onClose,
  onSendAnyway,
  onSetLabel,
}: {
  open: boolean;
  onClose: () => void;
  onSendAnyway: (dontShowAgain: boolean) => void;
  onSetLabel: (dontShowAgain: boolean) => void;
}) {
  const [dontShow, setDontShow] = useState(false);
  return (
    <Modal open={open} onClose={onClose} width={414}>
      <div className="relative px-9 pb-9 pt-9 text-center">
        <CloseButton onClick={onClose} />
        <h2 className="flex items-center justify-center gap-2 text-xl font-bold text-fg">
          <CircleAlert className="size-7 text-warning" strokeWidth={2.2} />
          라벨 미설정
        </h2>
        <p className="mt-4 text-[13px] font-medium leading-relaxed text-fg-2">
          라벨이 없으면 문서 분류에 어려움이 발생할 수 있습니다.
          <br />
          라벨을 설정하지 않고 전송하시겠어요?
        </p>
        <div className="mt-7 space-y-4">
          <button type="button" onClick={() => onSendAnyway(dontShow)} className={cn(primaryBtn, "w-full")}>
            이대로 전송
          </button>
          <button
            type="button"
            onClick={() => onSetLabel(dontShow)}
            className="h-10 w-full rounded-md bg-btn-dark text-sm font-semibold text-fg-2 hover:bg-btn-hover"
          >
            라벨 설정
          </button>
        </div>
        <div className="mt-6 flex justify-center">
          <Checkbox checked={dontShow} onChange={setDontShow} label={<span className="text-[13px] font-semibold">이 알림 다시 보지 않기</span>} />
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------ 전송 정보 확인 */

export interface ConfirmRow {
  id: string;
  name: string;
  email: string | null;
  delivery: DeliveryMethod | null;
}

export function SendConfirmModal({
  open,
  view,
  rows,
  sending,
  onClose,
  onSend,
}: {
  open: boolean;
  view: boolean;
  rows: ConfirmRow[];
  sending: boolean;
  onClose: () => void;
  onSend: () => void;
}) {
  return (
    <Modal open={open} onClose={sending ? noop : onClose} width={512} closeOnBackdrop={!sending}>
      <DialogFrame
        title="전송 정보 확인"
        onClose={sending ? noop : onClose}
        footer={
          <>
            <button type="button" onClick={onClose} disabled={sending} className={cn(ghostBtn, "bg-transparent hover:bg-btn-light")}>
              취소
            </button>
            <button type="button" onClick={onSend} disabled={sending} className={primaryBtn} autoFocus>
              {sending ? "전송 중…" : "전송하기"}
            </button>
          </>
        }
      >
        <p className="mt-2 text-[15px] leading-relaxed text-fg-2">모든 내용을 확인했으며, {view ? "열람" : "서명"} 요청을 전송합니다.</p>
        <div className="mt-7 flex items-center justify-between">
          <p className="text-xs font-bold text-fg">{view ? "아래 열람자들이 열람합니다." : "아래 서명자들이 서명합니다."}</p>
          <p className="text-xs text-fg-muted">총 {rows.length}명</p>
        </div>
        <ul className="mt-2 max-h-[300px] overflow-y-auto rounded border border-line-strong bg-surface-3 py-1">
          {rows.map((r) => (
            <li key={r.id} className="flex h-14 items-center justify-between gap-4 px-[18px]">
              <span className="truncate text-[13px] font-bold text-fg">{r.name}</span>
              <span className="truncate text-[13px] text-fg-2">{r.delivery === "in_person" ? "직접 대면" : r.email}</span>
            </li>
          ))}
        </ul>
      </DialogFrame>
    </Modal>
  );
}

/* --------------------------------------------------------- 라벨 설정 */

export function LabelModal({
  open,
  wid,
  labels,
  selected,
  onClose,
  onApply,
  onLabelCreated,
}: {
  open: boolean;
  wid: string;
  labels: Label[];
  selected: string[];
  onClose: () => void;
  onApply: (ids: string[]) => void;
  onLabelCreated: (label: Label) => void;
}) {
  const [picked, setPicked] = useState<string[]>(selected);
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(PARTICIPANT_COLORS[2]);
  const [creating, setCreating] = useState(false);

  async function create() {
    if (!name.trim() || creating) return;
    setCreating(true);
    const res = await createLabel(wid, name, color);
    setCreating(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    onLabelCreated(res.label);
    setPicked((p) => (p.includes(res.label.id) ? p : [...p, res.label.id]));
    setName("");
  }

  return (
    <Modal open={open} onClose={onClose} width={480}>
      <DialogFrame
        title="라벨 설정"
        onClose={onClose}
        footer={
          <>
            <button type="button" onClick={onClose} className={ghostBtn}>
              취소
            </button>
            <button type="button" onClick={() => onApply(picked)} className={primaryBtn}>
              적용
            </button>
          </>
        }
      >
        <p className="mt-2 text-sm text-fg-2">문서를 분류할 라벨을 선택하세요. 문서함에서 라벨로 문서를 찾을 수 있습니다.</p>
        <div className="mt-5 max-h-64 overflow-y-auto rounded border border-line-strong bg-surface-3">
          {labels.length === 0 ? (
            <p className="px-4 py-8 text-center text-[13px] text-fg-muted">등록된 라벨이 없습니다. 아래에서 새 라벨을 만들어 보세요.</p>
          ) : (
            <ul className="py-1">
              {labels.map((l) => (
                <li key={l.id} className="px-4 py-2">
                  <Checkbox
                    checked={picked.includes(l.id)}
                    onChange={(v) => setPicked((p) => (v ? [...p, l.id] : p.filter((x) => x !== l.id)))}
                    label={
                      <span className="inline-flex items-center gap-2">
                        <span className="size-2.5 rounded-full" style={{ background: l.color }} aria-hidden />
                        {l.name}
                      </span>
                    }
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="mt-4">
          <p className="text-[13px] font-medium text-fg-muted">새 라벨</p>
          <div className="mt-2 flex items-center gap-2">
            <Input
              value={name}
              maxLength={20}
              placeholder="라벨 이름 (20자 이내)"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                // ignore the Enter that commits a Korean IME syllable
                if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                  e.preventDefault();
                  void create();
                }
              }}
            />
            <button
              type="button"
              onClick={create}
              disabled={!name.trim() || creating}
              className="h-9 shrink-0 rounded border border-line-strong bg-btn-light px-3 text-[13px] font-semibold text-fg-2 hover:bg-btn-base disabled:text-fg-disabled"
            >
              {creating ? "추가 중…" : "추가"}
            </button>
          </div>
          <div className="mt-2.5 flex gap-1.5" role="radiogroup" aria-label="라벨 색상">
            {PARTICIPANT_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color === c}
                aria-label={`색상 ${c}`}
                onClick={() => setColor(c)}
                className={cn("size-5 rounded-full ring-offset-2 ring-offset-modal", color === c && "ring-2 ring-fg-3")}
                style={{ background: c }}
              />
            ))}
          </div>
        </div>
      </DialogFrame>
    </Modal>
  );
}

/* ------------------------------------------------------ 외부 참조자 */

type CcDraft = { key: number; name: string; email: string };

export function CcModal({ open, initial, onClose, onSave }: { open: boolean; initial: DocumentCc[]; onClose: () => void; onSave: (cc: DocumentCc[]) => Promise<boolean> }) {
  const [rows, setRows] = useState<CcDraft[]>(() =>
    initial.length ? initial.map((c, i) => ({ key: i, ...c })) : [{ key: 0, name: "", email: "" }],
  );
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const nextKey = useMemo(() => Math.max(0, ...rows.map((r) => r.key)) + 1, [rows]);

  const rowError = (r: CcDraft) => {
    const empty = !r.name.trim() && !r.email.trim();
    if (empty) return null;
    if (!r.name.trim()) return "이름을 입력해 주세요.";
    if (!EMAIL_RE.test(r.email.trim())) return "올바른 이메일 주소를 입력해 주세요.";
    return null;
  };

  async function save() {
    setSubmitted(true);
    if (rows.some(rowError)) return;
    const cc = rows.filter((r) => r.name.trim() || r.email.trim()).map((r) => ({ name: r.name.trim(), email: r.email.trim().toLowerCase() }));
    setSaving(true);
    const ok = await onSave(cc);
    setSaving(false);
    if (ok) onClose();
  }

  return (
    <Modal open={open} onClose={onClose} width={560}>
      <DialogFrame
        title="외부 참조자 설정"
        onClose={onClose}
        footer={
          <>
            <button type="button" onClick={onClose} className={ghostBtn}>
              취소
            </button>
            <button type="button" onClick={save} disabled={saving} className={primaryBtn}>
              {saving ? "저장 중…" : "저장"}
            </button>
          </>
        }
      >
        <p className="mt-2 text-sm leading-relaxed text-fg-2">
          참조자는 서명하지 않지만, 서명 요청이 시작될 때와 모든 서명이 완료되었을 때 이메일로 알림을 받습니다.
        </p>
        <ul className="mt-5 space-y-2.5">
          {rows.map((r, i) => {
            const err = submitted ? rowError(r) : null;
            return (
              <li key={r.key}>
                <div className="flex items-center gap-2">
                  <Input
                    aria-label={`참조자 ${i + 1} 이름`}
                    placeholder="이름"
                    maxLength={50}
                    value={r.name}
                    invalid={!!err && !r.name.trim()}
                    onChange={(e) => setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, name: e.target.value } : x)))}
                    className="h-10 w-40 shrink-0"
                  />
                  <Input
                    aria-label={`참조자 ${i + 1} 이메일`}
                    type="email"
                    placeholder="이메일 주소"
                    maxLength={254}
                    value={r.email}
                    invalid={!!err && !!r.name.trim()}
                    onChange={(e) => setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, email: e.target.value } : x)))}
                    className="h-10"
                  />
                  <button
                    type="button"
                    aria-label={`참조자 ${i + 1} 삭제`}
                    onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : [{ key: nextKey, name: "", email: "" }]))}
                    className="flex size-9 shrink-0 items-center justify-center rounded text-icon-2 hover:bg-btn-light"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
                {err && <p className="mt-1 text-xs text-negative">{err}</p>}
              </li>
            );
          })}
        </ul>
        <button
          type="button"
          disabled={rows.length >= MAX_CC}
          onClick={() => setRows((rs) => [...rs, { key: nextKey, name: "", email: "" }])}
          className="mt-3 flex h-9 w-full items-center justify-center gap-1.5 rounded border border-dashed border-line-strong text-[13px] font-semibold text-fg-2 hover:bg-btn-light disabled:text-fg-disabled"
        >
          <Plus className="size-4" />
          참조자 추가 ({rows.length}/{MAX_CC})
        </button>
      </DialogFrame>
    </Modal>
  );
}

/* --------------------------------------------------------- 예약 전송 */

const pad = (n: number) => String(n).padStart(2, "0");
const toLocalInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

function defaultSchedule() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return toLocalInput(d);
}

export function ScheduleModal({ open, busy, onClose, onSchedule }: { open: boolean; busy: boolean; onClose: () => void; onSchedule: (iso: string) => void }) {
  const [value, setValue] = useState(defaultSchedule);
  const [openedAt] = useState(() => Date.now());
  const min = toLocalInput(new Date(openedAt + 5 * 60_000));
  const date = value ? new Date(value) : null;
  // the server re-validates against the real current time
  const invalid = !date || Number.isNaN(date.getTime()) || date.getTime() < openedAt + 60_000;

  return (
    <Modal open={open} onClose={busy ? noop : onClose} width={440} closeOnBackdrop={!busy}>
      <DialogFrame
        title="예약 전송"
        onClose={busy ? noop : onClose}
        footer={
          <>
            <button type="button" onClick={onClose} disabled={busy} className={ghostBtn}>
              취소
            </button>
            <button type="button" disabled={invalid || busy} onClick={() => date && onSchedule(date.toISOString())} className={primaryBtn}>
              {busy ? "설정 중…" : "예약하기"}
            </button>
          </>
        }
      >
        <p className="mt-2 text-sm leading-relaxed text-fg-2">지정한 일시에 서명 요청이 자동으로 전송됩니다.</p>
        <label className="mt-5 block">
          <span className="text-[13px] font-medium text-fg-muted">전송 일시</span>
          <Input type="datetime-local" value={value} min={min} onChange={(e) => setValue(e.target.value)} className="mt-2 h-10" />
        </label>
        {value && invalid && <p className="mt-1.5 text-xs text-negative">현재 시각 이후로 지정해 주세요.</p>}
        <p className="mt-3 text-xs leading-relaxed text-fg-muted">예약한 문서는 문서함의 &lsquo;예약&rsquo;에서 확인할 수 있으며, 예약 시각 이후 문서함을 열면 전송이 진행됩니다.</p>
      </DialogFrame>
    </Modal>
  );
}
