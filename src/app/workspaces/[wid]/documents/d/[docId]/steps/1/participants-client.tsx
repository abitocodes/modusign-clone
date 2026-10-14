"use client";

import { Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useRef, useState, type DragEvent } from "react";
import { toast } from "sonner";

import { Radio } from "@/components/ui/controls";
import { Input, Textarea } from "@/components/ui/input";
import { ConfirmModal, Modal } from "@/components/ui/modal";
import { Segmented } from "@/components/ui/tabs";
import { WizardHeader, WizardNextButton } from "@/components/wizard/wizard-header";
import type { RequestType, SigningOrder } from "@/lib/types";

import { EMAIL_RE, MAX_PARTICIPANTS, uuid, type ParticipantInput, type PersonSuggestion } from "../../../_lib/types";
import { discardUnsavedDraft, saveAsTemplate, saveParticipants } from "./actions";
import { ParticipantCard } from "./participant-card";

const blankParticipant = (delivery: ParticipantInput["delivery"] = null): ParticipantInput => ({
  id: uuid(),
  name: "",
  email: "",
  phone: "",
  delivery,
  locale: "ko",
  authPassword: null,
  message: null,
  requestAttachment: false,
});

function emailIssue(p: ParticipantInput, all: ParticipantInput[]): string | null {
  if (p.delivery !== "email") return null;
  const email = p.email.trim().toLowerCase();
  if (!email) return "이메일을 입력해 주세요.";
  if (!EMAIL_RE.test(email)) return "올바른 이메일 주소를 입력해 주세요.";
  const dup = all.some((o) => o.id !== p.id && o.delivery === "email" && o.email.trim().toLowerCase() === email);
  return dup ? "이미 추가된 이메일 주소입니다." : null;
}

function isComplete(p: ParticipantInput, all: ParticipantInput[]) {
  return !!p.name.trim() && !!p.delivery && p.delivery !== "kakao" && !emailIssue(p, all);
}

/* ------------------------------------------------------------------ modals */

function ModalHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex items-start justify-between px-[30px] pt-[30px]">
      <h2 className="text-lg font-bold text-fg">{title}</h2>
      <button type="button" aria-label="닫기" onClick={onClose} className="-mr-2 -mt-1 flex size-8 items-center justify-center rounded text-icon-2 hover:bg-btn-light">
        <X className="size-5" />
      </button>
    </div>
  );
}

function AuthModal({ open, name, initial, onClose, onSave }: { open: boolean; name: string; initial: string | null; onClose: () => void; onSave: (pw: string | null) => void }) {
  const [enabled, setEnabled] = useState(!!initial);
  const [pw, setPw] = useState(initial ?? "");
  const invalid = enabled && (pw.length < 4 || pw.length > 20);
  return (
    <Modal open={open} onClose={onClose} width={480}>
      <ModalHeader title="인증 설정" onClose={onClose} />
      <div className="px-[30px] pb-2 pt-3">
        <p className="text-sm text-fg-2">{name ? `${name}님이` : "서명자가"} 문서를 열기 전에 거칠 인증 방법을 선택하세요.</p>
        <div className="mt-5 flex flex-col items-start gap-3 rounded border border-line-strong bg-surface-3 p-4" role="radiogroup" aria-label="인증 방법">
          <Radio name="auth" checked={!enabled} onChange={() => setEnabled(false)} label="추가 인증 없음 (이메일 확인만)" />
          <Radio name="auth" checked={enabled} onChange={() => setEnabled(true)} label="비밀번호 인증" />
          {enabled && (
            <div className="w-full pl-6">
              <Input
                type="password"
                autoFocus
                autoComplete="new-password"
                value={pw}
                maxLength={20}
                placeholder="비밀번호 (4~20자)"
                invalid={pw.length > 0 && invalid}
                onChange={(e) => setPw(e.target.value)}
                className="h-10"
              />
              <p className="mt-2 text-xs leading-relaxed text-fg-muted">비밀번호는 서명 요청 메일에 포함되지 않습니다. 서명자에게 별도로 알려 주세요.</p>
            </div>
          )}
        </div>
      </div>
      <div className="flex justify-end gap-2 px-[30px] pb-[30px] pt-5">
        <button type="button" onClick={onClose} className="h-10 rounded-md bg-btn-light px-4 text-sm font-medium text-fg-2 hover:bg-btn-base">
          취소
        </button>
        <button
          type="button"
          disabled={invalid}
          onClick={() => onSave(enabled ? pw : null)}
          className="h-10 rounded-md bg-primary px-[22px] text-sm font-medium text-primary-fg hover:bg-primary-hover disabled:bg-btn-disabled disabled:text-fg-disabled"
        >
          저장
        </button>
      </div>
    </Modal>
  );
}

function MessageModal({ open, name, initial, onClose, onSave }: { open: boolean; name: string; initial: string | null; onClose: () => void; onSave: (m: string | null) => void }) {
  const [text, setText] = useState(initial ?? "");
  return (
    <Modal open={open} onClose={onClose} width={480}>
      <ModalHeader title="남길 말" onClose={onClose} />
      <div className="px-[30px] pt-3">
        <p className="text-sm text-fg-2">{name ? `${name}님에게` : "서명자에게"} 전달할 메시지를 입력하세요. 서명 요청 메일과 서명 화면에 표시됩니다.</p>
        <Textarea
          autoFocus
          rows={6}
          maxLength={500}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="예) 계약 내용 확인 후 서명 부탁드립니다."
          className="mt-4 bg-surface-3"
        />
        <p className="mt-1 text-right text-[11px] text-fg-muted">{text.length}/500</p>
      </div>
      <div className="flex justify-end gap-2 px-[30px] pb-[30px] pt-4">
        <button type="button" onClick={onClose} className="h-10 rounded-md bg-btn-light px-4 text-sm font-medium text-fg-2 hover:bg-btn-base">
          취소
        </button>
        <button
          type="button"
          onClick={() => onSave(text.trim() ? text.trim() : null)}
          className="h-10 rounded-md bg-primary px-[22px] text-sm font-medium text-primary-fg hover:bg-primary-hover"
        >
          저장
        </button>
      </div>
    </Modal>
  );
}

function ExitModal({ open, busy, onClose, onDiscard, onSave }: { open: boolean; busy: boolean; onClose: () => void; onDiscard: () => void; onSave: () => void }) {
  return (
    <Modal open={open} onClose={onClose} width={414}>
      <div className="relative px-9 pb-9 pt-9 text-center">
        <button type="button" aria-label="닫기" onClick={onClose} className="absolute right-4 top-4 flex size-8 items-center justify-center rounded text-icon-2 hover:bg-btn-light">
          <X className="size-5" />
        </button>
        <h2 className="text-xl font-bold text-fg">작성 중인 내용을 임시 저장할까요?</h2>
        <p className="mt-3 text-[13px] font-medium leading-relaxed text-fg-2">
          임시 저장한 문서는 문서함의 &lsquo;작성 중&rsquo;에서
          <br />
          이어서 작성할 수 있습니다.
        </p>
        <div className="mt-6 space-y-2">
          <button
            type="button"
            disabled={busy}
            onClick={onSave}
            className="h-10 w-full rounded-md bg-primary text-sm font-semibold text-primary-fg hover:bg-primary-hover disabled:opacity-60"
          >
            임시 저장
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onDiscard}
            className="h-10 w-full rounded-md bg-btn-dark text-sm font-semibold text-fg-2 hover:bg-btn-hover disabled:opacity-60"
          >
            저장하지 않고 나가기
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ page */

export function ParticipantsClient({
  wid,
  docId,
  initialRequestType,
  initialSigningOrder,
  initialParticipants,
  fieldCounts,
  suggestions,
}: {
  wid: string;
  docId: string;
  initialRequestType: RequestType;
  initialSigningOrder: SigningOrder;
  initialParticipants: ParticipantInput[];
  fieldCounts: Record<string, number>;
  suggestions: PersonSuggestion[];
}) {
  const router = useRouter();
  const [requestType, setRequestType] = useState<RequestType>(initialRequestType);
  const [signingOrder, setSigningOrder] = useState<SigningOrder>(initialSigningOrder);
  const [list, setList] = useState<ParticipantInput[]>(() => (initialParticipants.length ? initialParticipants : [blankParticipant()]));
  const [saving, setSaving] = useState<null | "next" | "temp" | "template" | "exit">(null);
  const [authIndex, setAuthIndex] = useState<number | null>(null);
  const [messageIndex, setMessageIndex] = useState<number | null>(null);
  const [deleteIndex, setDeleteIndex] = useState<number | null>(null);
  const [exitOpen, setExitOpen] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const nameRefs = useRef(new Map<string, HTMLInputElement>());
  const cardRefs = useRef(new Map<string, HTMLDivElement>());

  const who = requestType === "view" ? "열람자" : "서명자";
  const sequential = signingOrder === "sequential";
  const valid = useMemo(() => list.length > 0 && list.every((p) => isComplete(p, list)), [list]);
  const base = `/workspaces/${wid}`;

  const update = useCallback((index: number, patch: Partial<ParticipantInput>) => {
    setList((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  }, []);

  function move(from: number, to: number) {
    if (to < 0 || to >= list.length || from === to) return;
    setList((prev) => {
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  }

  function add() {
    if (list.length >= MAX_PARTICIPANTS) return;
    const p = blankParticipant(list[list.length - 1]?.delivery ?? null);
    setList((prev) => [...prev, p]);
    requestAnimationFrame(() => {
      cardRefs.current.get(p.id)?.scrollIntoView({ behavior: "smooth", block: "center" });
      nameRefs.current.get(p.id)?.focus({ preventScroll: true });
    });
  }

  function remove(index: number) {
    setList((prev) => prev.filter((_, i) => i !== index));
  }

  async function persist(mode: "draft" | "strict") {
    const res = await saveParticipants(docId, { requestType, signingOrder, participants: list }, mode);
    if (!res.ok) toast.error(res.error);
    return res.ok;
  }

  async function next() {
    if (!valid || saving) return;
    setSaving("next");
    if (await persist("strict")) {
      router.push(`${base}/documents/d/${docId}/steps/2`);
      return;
    }
    setSaving(null);
  }

  async function tempSave() {
    if (saving) return;
    setSaving("temp");
    if (await persist("draft")) toast.success("임시 저장되었습니다.");
    setSaving(null);
  }

  async function saveTemplate() {
    if (saving) return;
    setSaving("template");
    try {
      if (!(await persist("draft"))) return;
      const res = await saveAsTemplate(docId);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("템플릿으로 저장되었습니다.", {
        action: { label: "템플릿 보기", onClick: () => router.push(`${base}/esign/requests/templates`) },
      });
    } finally {
      setSaving(null);
    }
  }

  async function exitWithSave() {
    setSaving("exit");
    if (await persist("draft")) {
      router.push(`${base}/esign/documents/documents?status=draft`);
      return;
    }
    setSaving(null);
  }

  async function exitWithoutSave() {
    setSaving("exit");
    await discardUnsavedDraft(docId);
    router.push(`${base}/esign/requests/request`);
  }

  function onHandleDragStart(index: number, e: DragEvent<HTMLButtonElement>) {
    setDragIndex(index);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(index));
    const card = cardRefs.current.get(list[index].id);
    if (card) e.dataTransfer.setDragImage(card, card.offsetWidth / 2, 16);
  }

  function onCardDragOver(index: number, e: DragEvent<HTMLDivElement>) {
    if (dragIndex === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (overIndex !== index) setOverIndex(index);
  }

  function onCardDrop(index: number, e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    if (dragIndex !== null) move(dragIndex, index);
    setDragIndex(null);
    setOverIndex(null);
  }

  const authTarget = authIndex !== null ? list[authIndex] : null;
  const messageTarget = messageIndex !== null ? list[messageIndex] : null;

  return (
    <div className="flex min-h-screen flex-col bg-surface-2">
      <WizardHeader
        backLabel="나가기"
        showBackChevron={false}
        onBack={() => setExitOpen(true)}
        onTempSave={tempSave}
        onSaveAsTemplate={saveTemplate}
        primary={<WizardNextButton disabled={!valid || (saving !== null && saving !== "next")} loading={saving === "next"} onClick={next} />}
      />

      <main className="mx-auto w-full max-w-[872px] flex-1 px-4 pb-24 pt-6">
        <h1 className="sr-only">참여자 설정</h1>
        <div className="flex flex-wrap gap-2.5">
          <Segmented<RequestType>
            options={[
              { value: "sign", label: "서명" },
              { value: "view", label: "열람" },
            ]}
            value={requestType}
            onChange={setRequestType}
          />
          <Segmented<SigningOrder>
            options={[
              { value: "sequential", label: "순서대로" },
              { value: "parallel", label: "순서없이" },
            ]}
            value={signingOrder}
            onChange={setSigningOrder}
          />
        </div>

        <div className="mt-[18px] space-y-6">
          {list.map((p, i) => (
            <ParticipantCard
              key={p.id}
              index={i}
              participant={p}
              who={who}
              sequential={sequential}
              isView={requestType === "view"}
              canDelete={list.length >= 2}
              emailError={emailIssue(p, list)}
              suggestions={suggestions}
              onChange={(patch) => update(i, patch)}
              onDelete={() => ((fieldCounts[p.id] ?? 0) > 0 ? setDeleteIndex(i) : remove(i))}
              onOpenAuth={() => setAuthIndex(i)}
              onOpenMessage={() => setMessageIndex(i)}
              onMove={(dir) => move(i, i + dir)}
              setNameEl={(el) => {
                if (el) nameRefs.current.set(p.id, el);
                else nameRefs.current.delete(p.id);
              }}
              setCardEl={(el) => {
                if (el) cardRefs.current.set(p.id, el);
                else cardRefs.current.delete(p.id);
              }}
              dragging={dragIndex === i}
              dropTarget={dragIndex !== null && overIndex === i && dragIndex !== i}
              onHandleDragStart={(e) => onHandleDragStart(i, e)}
              onDragEnd={() => {
                setDragIndex(null);
                setOverIndex(null);
              }}
              onDragOver={(e) => onCardDragOver(i, e)}
              onDrop={(e) => onCardDrop(i, e)}
            />
          ))}
        </div>

        <button
          type="button"
          onClick={add}
          disabled={list.length >= MAX_PARTICIPANTS}
          className="mt-6 flex h-[85px] w-full items-center justify-center gap-2 rounded-md bg-btn-dark text-sm font-semibold text-fg-2 transition-colors hover:bg-btn-hover disabled:bg-btn-disabled disabled:text-fg-disabled"
        >
          <Plus className="size-[18px]" />
          {who} 추가
          <span className="font-normal">
            ({list.length}/{MAX_PARTICIPANTS})
          </span>
        </button>
      </main>

      {authTarget && (
        <AuthModal
          key={authTarget.id}
          open
          name={authTarget.name}
          initial={authTarget.authPassword}
          onClose={() => setAuthIndex(null)}
          onSave={(pw) => {
            update(authIndex!, { authPassword: pw });
            setAuthIndex(null);
          }}
        />
      )}
      {messageTarget && (
        <MessageModal
          key={messageTarget.id}
          open
          name={messageTarget.name}
          initial={messageTarget.message}
          onClose={() => setMessageIndex(null)}
          onSave={(m) => {
            update(messageIndex!, { message: m });
            setMessageIndex(null);
          }}
        />
      )}
      <ConfirmModal
        open={deleteIndex !== null}
        onClose={() => setDeleteIndex(null)}
        onConfirm={() => deleteIndex !== null && remove(deleteIndex)}
        title={`${who}를 삭제할까요?`}
        description={`이 ${who}에게 배치한 입력란도 저장할 때 함께 삭제됩니다.`}
        confirmLabel="삭제"
        danger
      />
      <ExitModal open={exitOpen} busy={saving === "exit"} onClose={() => setExitOpen(false)} onSave={exitWithSave} onDiscard={exitWithoutSave} />
    </div>
  );
}
