"use client";

import { Signature, Stamp, X } from "lucide-react";
import type { ReactNode } from "react";

import { Modal } from "@/components/ui/modal";

export type SignMethod = "sign" | "stamp";

/** "서명 방식 선택" — small modal shown before the 사인/도장 dialogs when a field allows both. */
export function SignMethodPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (kind: SignMethod) => void }) {
  return (
    <Modal open={open} onClose={onClose} width={336}>
      <div className="relative px-9 pb-9 pt-[42px] text-center">
        <button
          type="button"
          aria-label="닫기"
          onClick={onClose}
          className="absolute right-3 top-3 flex size-[34px] items-center justify-center rounded-lg text-icon-2 hover:bg-btn-light"
        >
          <X className="size-5" />
        </button>
        <h2 className="text-xl font-bold text-fg">서명 방식 선택</h2>
        <p className="mt-6 text-sm font-medium text-fg-2">어떤 방식으로 서명을 입력할까요?</p>
        <div className="mt-6 flex justify-center gap-4">
          <MethodTile label="사인" icon={<Signature />} onClick={() => onPick("sign")} autoFocus />
          <MethodTile label="도장" icon={<Stamp />} onClick={() => onPick("stamp")} />
        </div>
      </div>
    </Modal>
  );
}

function MethodTile({ label, icon, onClick, autoFocus }: { label: string; icon: ReactNode; onClick: () => void; autoFocus?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      autoFocus={autoFocus}
      className="group flex w-[124px] flex-col items-center gap-[22px] rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-emphasis"
    >
      <span className="flex h-[90px] w-full items-center justify-center rounded-lg bg-btn-dark text-fg-muted transition-colors group-hover:bg-btn-hover group-hover:text-fg [&_svg]:size-5">
        {icon}
      </span>
      <span className="text-base font-medium text-fg-muted transition-colors group-hover:text-fg">{label}</span>
    </button>
  );
}
