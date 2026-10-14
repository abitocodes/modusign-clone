"use client";

import { ChevronDown, ChevronLeft, ChevronRight, CircleHelp } from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";

import { Dropdown, MenuItem } from "@/components/ui/menu";
import { cn } from "@/lib/utils";

/**
 * Header of the full-screen sign-request wizard (업로드 / 참여자 / 입력란 / 요청 정보).
 * h64, bg #212121, bottom border.
 */
export function WizardHeader({
  backLabel = "이전",
  onBack,
  showBackChevron = true,
  onTempSave,
  onSaveAsTemplate,
  extra,
  primary,
}: {
  backLabel?: string;
  onBack?: () => void;
  showBackChevron?: boolean;
  /** shows the "임시 저장 ∨" dropdown when provided */
  onTempSave?: () => void;
  onSaveAsTemplate?: () => void;
  /** extra buttons left of the primary button (e.g. 미리보기) */
  extra?: ReactNode;
  /** primary action, e.g. <WizardNextButton …/> */
  primary?: ReactNode;
}) {
  return (
    <header className="sticky top-0 z-40 flex h-16 shrink-0 items-center justify-between border-b border-line bg-surface px-8">
      <div>
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="flex h-[42px] items-center gap-2 rounded-md bg-btn-light px-5 text-base font-medium text-fg-2 shadow-button hover:bg-btn-base"
          >
            {showBackChevron && <ChevronLeft className="size-4" />}
            {backLabel}
          </button>
        )}
      </div>
      <div className="flex items-center gap-4">
        <button
          type="button"
          aria-label="도움말"
          onClick={() => toast("도움말은 준비 중입니다.")}
          className="flex size-10 items-center justify-center rounded-full hover:bg-btn-light"
        >
          <CircleHelp className="size-[22px] fill-icon text-surface" strokeWidth={2.4} />
        </button>
        {onTempSave && (
          <Dropdown
            align="right"
            panelClassName="w-40"
            trigger={(open, toggle) => (
              <button
                type="button"
                onClick={toggle}
                className={cn(
                  "flex h-[42px] items-center gap-1.5 rounded-md border border-line bg-btn-light px-6 text-base font-medium text-fg-2 hover:bg-btn-base",
                  open && "bg-btn-base",
                )}
              >
                임시 저장
                <ChevronDown className="size-4" />
              </button>
            )}
          >
            {(close) => (
              <>
                <MenuItem onClick={() => { close(); onTempSave(); }}>임시 저장</MenuItem>
                {onSaveAsTemplate && <MenuItem onClick={() => { close(); onSaveAsTemplate(); }}>템플릿으로 저장</MenuItem>}
              </>
            )}
          </Dropdown>
        )}
        {extra}
        {primary}
      </div>
    </header>
  );
}

export function WizardNextButton({
  children = "다음으로",
  disabled,
  onClick,
  loading,
}: {
  children?: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  loading?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      onClick={onClick}
      className="flex h-[42px] min-w-[118px] items-center justify-center gap-1.5 rounded-md bg-primary px-6 text-base font-medium text-primary-fg shadow-button hover:bg-primary-hover disabled:bg-btn-disabled disabled:text-fg-disabled disabled:shadow-none"
    >
      {loading ? "처리 중…" : children}
      {!loading && <ChevronRight className="size-4" />}
    </button>
  );
}
