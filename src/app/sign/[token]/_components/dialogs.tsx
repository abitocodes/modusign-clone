"use client";

import { Check, LoaderCircle, X } from "lucide-react";
import { useId, useState } from "react";

import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";

import { MAX_REJECT_REASON } from "../_lib/validate";
import { InfoModal } from "./chrome";

function DialogClose({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-label="닫기"
      onClick={onClick}
      disabled={disabled}
      className="absolute right-3 top-3 flex size-[34px] items-center justify-center rounded-lg text-icon-2 hover:bg-btn-light disabled:opacity-50"
    >
      <X className="size-5" />
    </button>
  );
}

const CONSENT_LINES = [
  "문서의 내용을 모두 확인했으며 전자서명에 동의합니다.",
  "전자서명과 전자문서의 법적 효력에 동의합니다.",
  "서명 완료 후 받는 전자문서를 원본으로 인정합니다.",
  "모든 서명자에게 서명 권한이 있음을 확인했습니다.",
];

/** 내용 확인 및 전자서명 동의 */
export function ConsentModal({ open, busy, onClose, onAgree }: { open: boolean; busy: boolean; onClose: () => void; onAgree: () => void }) {
  const [terms, setTerms] = useState(false);
  const titleId = useId();
  return (
    <>
      {/* while the 이용약관 dialog is on top, Escape only closes that one */}
      <Modal open={open} onClose={busy || terms ? () => {} : onClose} width={512} closeOnBackdrop={!busy && !terms}>
        <div className="relative p-[30px]" aria-labelledby={titleId}>
          <DialogClose onClick={onClose} disabled={busy} />
          <h2 id={titleId} className="pr-8 text-lg font-bold text-fg">
            내용 확인 및 전자서명 동의
          </h2>
          <ul className="mt-6 space-y-1.5 rounded border border-line-strong bg-surface-3 p-[22px]">
            {CONSENT_LINES.map((l) => (
              <li key={l} className="flex gap-1.5 text-[13px] text-fg">
                <Check className="mt-[3px] size-3.5 shrink-0 text-fg-muted" strokeWidth={2} />
                {l}
              </li>
            ))}
            <li className="flex gap-1.5 text-[13px] text-fg">
              <Check className="mt-[3px] size-3.5 shrink-0 text-fg-muted" strokeWidth={2} />
              <span>
                그 밖의 사항은{" "}
                <button type="button" onClick={() => setTerms(true)} className="text-fg-3 underline underline-offset-2 hover:text-fg">
                  전자서명 이용약관
                </button>
                을 따릅니다.
              </span>
            </li>
          </ul>
          <div className="mt-[30px] flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="h-10 rounded bg-btn-light px-4 text-sm font-medium text-fg-2 hover:bg-btn-base disabled:opacity-50"
            >
              취소
            </button>
            <button
              type="button"
              onClick={onAgree}
              disabled={busy}
              autoFocus
              aria-busy={busy}
              className="flex h-10 items-center gap-1.5 rounded bg-primary px-[22px] text-sm font-bold text-primary-fg shadow-button hover:bg-primary-hover disabled:opacity-70"
            >
              {busy && <LoaderCircle className="size-4 animate-spin" />}
              동의하고 서명합니다
            </button>
          </div>
        </div>
      </Modal>
      <InfoModal open={terms} onClose={() => setTerms(false)} title="전자서명 이용약관">
        <div className="space-y-3 text-[13px] leading-relaxed text-fg">
          <p>
            <b>제1조 (목적)</b> 이 약관은 OpenSign(이하 &lsquo;서비스&rsquo;)을 이용한 전자서명 및 전자문서의 작성·보관에 필요한
            사항을 정합니다.
          </p>
          <p>
            <b>제2조 (전자서명의 효력)</b> 서명자가 본인 확인을 거쳐 입력한 전자서명은 서명자의 의사에 따른 서명으로 보며, 서명이
            완료된 전자문서는 종이 문서와 같은 효력을 가집니다.
          </p>
          <p>
            <b>제3조 (기록의 보관)</b> 서비스는 서명 일시, 접속 IP 등 진행 이력을 감사 추적 인증서로 기록하고 완료 문서와 함께
            보관합니다.
          </p>
          <p>
            <b>제4조 (문의)</b> 문서 내용과 관련한 문의는 서명을 요청한 담당자에게 해 주세요.
          </p>
        </div>
      </InfoModal>
    </>
  );
}

/** 서명 거절 — a reason is required */
export function RejectModal({
  open,
  busy,
  onClose,
  onReject,
}: {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onReject: (reason: string) => void;
}) {
  return (
    <Modal open={open} onClose={busy ? () => {} : onClose} width={480} closeOnBackdrop={!busy}>
      {/* re-mounted on every open so the reason starts empty */}
      {open && <RejectBody busy={busy} onClose={onClose} onReject={onReject} />}
    </Modal>
  );
}

function RejectBody({ busy, onClose, onReject }: { busy: boolean; onClose: () => void; onReject: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  const ids = { title: useId(), field: useId(), hint: useId() };
  const ok = reason.trim().length > 0;
  return (
    <form
      className="relative p-[30px]"
      aria-labelledby={ids.title}
      onSubmit={(e) => {
        e.preventDefault();
        if (ok && !busy) onReject(reason.trim());
      }}
    >
      <DialogClose onClick={onClose} disabled={busy} />
      <h2 id={ids.title} className="pr-8 text-lg font-bold text-fg">
        서명 거절
      </h2>
      <p id={ids.hint} className="mt-3 text-[13px] leading-relaxed text-fg-2">
        서명을 거절하면 이 문서의 서명 절차가 종료되며, 입력한 거절 사유가 요청자에게 전달됩니다.
      </p>
      <label htmlFor={ids.field} className="mt-5 block text-[13px] font-bold text-fg">
        거절 사유 <span className="text-negative">*</span>
      </label>
      <textarea
        id={ids.field}
        value={reason}
        autoFocus
        required
        maxLength={MAX_REJECT_REASON}
        rows={5}
        aria-describedby={ids.hint}
        placeholder="거절 사유를 입력해 주세요."
        onChange={(e) => setReason(e.target.value)}
        className="mt-2 w-full resize-none rounded border border-line-strong bg-surface px-3 py-2.5 text-sm text-fg outline-none placeholder:text-fg-disabled focus:border-emphasis focus:shadow-focus"
      />
      <p className="mt-1 text-right text-[11px] text-fg-muted">
        {reason.length}/{MAX_REJECT_REASON}
      </p>
      <div className="mt-5 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="h-10 rounded bg-btn-light px-4 text-sm font-medium text-fg-2 hover:bg-btn-base disabled:opacity-50"
        >
          취소
        </button>
        <button
          type="submit"
          disabled={!ok || busy}
          className={cn(
            "flex h-10 items-center gap-1.5 rounded border px-[22px] text-sm font-bold transition-colors",
            ok ? "border-negative-border bg-negative-bg text-negative hover:brightness-110" : "border-line bg-btn-disabled text-fg-disabled",
          )}
        >
          {busy && <LoaderCircle className="size-4 animate-spin" />}
          거절하기
        </button>
      </div>
    </form>
  );
}
