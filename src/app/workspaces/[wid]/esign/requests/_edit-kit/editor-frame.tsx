"use client";

import { ChevronLeft, CircleQuestionMark } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";

/**
 * Full-screen editor surface (covers the e-sign shell: header, sidebar, help button)
 * used by the 문서 편집기 and 서식 작성기 editors.
 */
export function EditorFrame({ children, className }: { children: ReactNode; className?: string }) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
  return <div className={cn("fixed inset-0 z-[60] flex flex-col bg-body-2 text-fg", className)}>{children}</div>;
}

/** Top bar (h64) — 나가기 on the left, title in the middle-left, actions on the right (WizardHeader look). */
export function EditorHeader({
  onExit,
  title,
  status,
  children,
}: {
  onExit: () => void;
  title?: ReactNode;
  status?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-line bg-surface px-8">
      <div className="flex min-w-0 items-center gap-4">
        <button
          type="button"
          onClick={onExit}
          className="flex h-[42px] shrink-0 items-center gap-1.5 rounded-md bg-btn-light px-5 text-base font-medium text-fg-2 shadow-button hover:bg-btn-base"
        >
          <ChevronLeft className="size-4" />
          나가기
        </button>
        {title != null && <div className="min-w-0 truncate text-base font-medium text-fg">{title}</div>}
        {status}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <button
          type="button"
          aria-label="도움말"
          onClick={() => toast("도움말은 준비 중입니다.")}
          className="flex size-10 items-center justify-center rounded-full hover:bg-btn-light"
        >
          <CircleQuestionMark className="size-[22px] fill-icon text-surface" strokeWidth={2.4} />
        </button>
        {children}
      </div>
    </header>
  );
}

/** Secondary header button (저장). */
export function HeaderButton({
  children,
  onClick,
  disabled,
  icon,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  icon?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex h-[42px] items-center gap-1.5 rounded-md border border-line bg-btn-light px-5 text-base font-medium text-fg-2 hover:bg-btn-base disabled:cursor-default disabled:text-fg-disabled disabled:hover:bg-btn-light"
    >
      {icon}
      {children}
    </button>
  );
}

/** Primary header button (서명 요청하기 / PDF로 서명 요청). */
export function HeaderPrimaryButton({
  children,
  onClick,
  disabled,
  icon,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  icon?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex h-[42px] min-w-[118px] items-center justify-center gap-1.5 rounded-md bg-primary px-6 text-base font-medium text-primary-fg shadow-button hover:bg-primary-hover disabled:bg-btn-disabled disabled:text-fg-disabled disabled:shadow-none"
    >
      {icon}
      {children}
    </button>
  );
}

/** Toolbar icon/label button (h36) — `active` uses the emphasis style. */
export function ToolButton({
  label,
  icon,
  active,
  disabled,
  onClick,
  showLabel = true,
  shortcut,
}: {
  label: string;
  icon: ReactNode;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  showLabel?: boolean;
  shortcut?: string;
}) {
  return (
    <button
      type="button"
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        "flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg text-[13px] font-medium transition-colors [&_svg]:size-[18px]",
        showLabel ? "px-2.5" : "w-9",
        active ? "bg-emphasis-bg text-emphasis" : "text-icon-2 hover:bg-menu-hover",
        disabled && "pointer-events-none text-fg-disabled opacity-60",
      )}
    >
      {icon}
      {showLabel && <span>{label}</span>}
    </button>
  );
}

export function ToolDivider() {
  return <span aria-hidden className="mx-1.5 h-6 w-px shrink-0 bg-line" />;
}

/** Full-screen blocking overlay while a long task (PDF 생성/업로드) runs. */
export function BusyOverlay({ message }: { message: string }) {
  return (
    <div role="status" aria-live="polite" className="fixed inset-0 z-[90] flex items-center justify-center bg-backdrop">
      <div className="flex min-w-[280px] flex-col items-center gap-4 rounded-lg bg-modal px-8 py-7 shadow-modal">
        <span className="inline-block size-8 animate-spin rounded-full border-[3px] border-line-strong border-t-warning" />
        <p className="text-sm font-medium text-fg-2">{message}</p>
      </div>
    </div>
  );
}
