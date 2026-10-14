"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Underline tabs used inside dialogs (그리기 | 사인 만들기 | 업로드) — active = yellow 3px bar. */
export function UnderlineTabs<T extends string>({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: { value: T; label: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div role="tablist" className={cn("flex h-[45px] justify-center border-b border-line-light", className)}>
      {tabs.map((t) => {
        const active = t.value === value;
        return (
          <button
            key={t.value}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(t.value)}
            className={cn(
              "relative px-3 text-[15px]",
              active ? "font-bold text-fg-2" : "font-normal text-fg-muted hover:text-fg-2",
            )}
          >
            {t.label}
            {active && <span className="absolute inset-x-0 bottom-0 h-[3px] rounded-t bg-warning" />}
          </button>
        );
      })}
    </div>
  );
}

/** Segmented control: [서명 | 열람], [순서대로 | 순서없이], [기본 | 자동 입력] */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = "md",
  className,
}: {
  options: { value: T; label: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <div role="tablist" className={cn("inline-flex rounded-lg bg-btn-dark p-1", className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "flex-1 rounded-[5px] font-medium transition-colors",
              size === "md" ? "h-[34px] px-5 text-sm" : "h-[29px] px-3 text-[13px]",
              active ? "bg-btn-light text-fg shadow-button" : "text-fg-2 hover:text-fg",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
