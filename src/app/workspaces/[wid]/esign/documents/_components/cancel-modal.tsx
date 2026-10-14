"use client";

import { CircleX } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";

const MAX = 200;

/** 서명 요청 취소 — optional reason, irreversible. */
export function CancelRequestModal({
  open,
  title,
  pending,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  pending?: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const close = () => {
    if (pending) return;
    setReason("");
    onClose();
  };
  return (
    <Modal
      open={open}
      onClose={close}
      width={480}
      title="서명 요청 취소"
      icon={<CircleX />}
      footerBar
      footer={
        <>
          <Button variant="light" size="md" onClick={close} disabled={pending}>
            닫기
          </Button>
          <Button variant="danger" size="md" onClick={() => onConfirm(reason.trim())} disabled={pending}>
            {pending ? "취소하는 중…" : "서명 요청 취소"}
          </Button>
        </>
      }
    >
      <div className="px-[30px] py-6">
        <p className="text-sm leading-relaxed text-fg-2">
          <strong className="font-bold text-fg">{title}</strong> 문서의 서명 요청을 취소할까요?
          <br />
          취소하면 참여자는 더 이상 문서에 서명할 수 없고, 되돌릴 수 없습니다.
        </p>
        <label className="mt-5 block">
          <span className="mb-1.5 block text-[13px] font-medium text-fg-muted">취소 사유 (선택)</span>
          <Textarea
            rows={4}
            value={reason}
            maxLength={MAX}
            onChange={(e) => setReason(e.target.value)}
            placeholder="참여자에게 전달할 취소 사유를 입력하세요."
          />
        </label>
        <p className="mt-1 text-right text-[11px] text-fg-muted">
          {reason.length}/{MAX}
        </p>
      </div>
    </Modal>
  );
}
