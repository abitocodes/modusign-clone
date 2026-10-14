"use client";

import { X } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  icon?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** panel width in px (default 672 like the 사인 입력 dialog) */
  width?: number;
  /** center footer buttons (사인 입력) vs. right aligned (새 연락처) */
  footerAlign?: "center" | "right" | "between";
  /** footer drawn as a separate grey bar with top border */
  footerBar?: boolean;
  className?: string;
  bodyClassName?: string;
  closeOnBackdrop?: boolean;
}

export function Modal({
  open,
  onClose,
  title,
  icon,
  children,
  footer,
  width = 672,
  footerAlign = "right",
  footerBar = false,
  className,
  bodyClassName,
  closeOnBackdrop = true,
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-backdrop px-4 py-[66px]">
      <div className="fixed inset-0" onClick={closeOnBackdrop ? onClose : undefined} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        className={cn("relative flex max-h-[calc(100vh-132px)] w-full flex-col rounded bg-modal shadow-modal", className)}
        style={{ maxWidth: width }}
      >
        {title != null && (
          <div className="flex h-[65px] shrink-0 items-center gap-2.5 rounded-t-md border-b border-line-strong bg-modal-head pl-[18px] pr-[18px]">
            {icon && <span className="text-fg-muted [&_svg]:size-[18px]">{icon}</span>}
            <h1 className="flex-1 truncate text-lg font-bold text-fg-muted">{title}</h1>
            <button
              type="button"
              aria-label="닫기"
              onClick={onClose}
              className="flex size-[34px] items-center justify-center rounded-lg text-icon-2 hover:bg-btn-light"
            >
              <X className="size-5" />
            </button>
          </div>
        )}
        <div className={cn("min-h-0 flex-1 overflow-y-auto", bodyClassName)}>{children}</div>
        {footer && (
          <div
            className={cn(
              "flex shrink-0 items-center gap-2 px-[30px] py-3",
              footerBar && "border-t border-line-strong bg-modal-foot",
              !footerBar && "pb-[30px]",
              footerAlign === "center" && "justify-center",
              footerAlign === "right" && "justify-end",
              footerAlign === "between" && "justify-between",
            )}
          >
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** Simple confirm dialog */
export function ConfirmModal({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "확인",
  cancelLabel = "취소",
  danger,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}) {
  return (
    <Modal open={open} onClose={onClose} width={420}>
      <div className="px-8 pb-2 pt-8 text-center">
        <h2 className="text-lg font-bold text-fg">{title}</h2>
        {description && <div className="mt-3 text-sm leading-relaxed text-fg-2">{description}</div>}
      </div>
      <div className="flex justify-center gap-2 px-8 pb-8 pt-6">
        <button type="button" onClick={onClose} className="h-10 min-w-20 rounded-md bg-btn-dark px-4 text-sm font-medium text-fg-2 hover:bg-btn-hover">
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={() => {
            onConfirm();
            onClose();
          }}
          className={cn(
            "h-10 min-w-20 rounded-md px-4 text-sm font-medium",
            danger ? "bg-negative-bg text-negative hover:brightness-110" : "bg-primary text-primary-fg hover:bg-primary-hover",
          )}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
