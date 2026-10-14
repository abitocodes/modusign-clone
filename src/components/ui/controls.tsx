"use client";

import { Check } from "lucide-react";
import type { InputHTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/utils";

export function Checkbox({
  checked,
  onChange,
  label,
  className,
  size = 16,
  disabled,
  ...rest
}: {
  checked: boolean;
  onChange?: (v: boolean) => void;
  label?: ReactNode;
  className?: string;
  size?: number;
  disabled?: boolean;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "checked" | "size">) {
  return (
    <label className={cn("inline-flex cursor-pointer select-none items-center gap-2", disabled && "opacity-50", className)}>
      <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
        <input
          type="checkbox"
          className="peer absolute inset-0 cursor-pointer opacity-0"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange?.(e.target.checked)}
          {...rest}
        />
        <span
          className={cn(
            "flex size-full items-center justify-center rounded-[2px] border shadow-input transition-colors",
            checked ? "border-radio-on bg-radio-on" : "border-line-strong bg-surface",
            "peer-focus-visible:ring-2 peer-focus-visible:ring-emphasis",
          )}
        >
          {checked && <Check className="size-[85%] text-white" strokeWidth={3.5} />}
        </span>
      </span>
      {label != null && <span className="text-sm font-medium text-fg">{label}</span>}
    </label>
  );
}

export function Radio({
  checked,
  onChange,
  label,
  name,
  className,
}: {
  checked: boolean;
  onChange?: () => void;
  label?: ReactNode;
  name?: string;
  className?: string;
}) {
  return (
    <label className={cn("inline-flex cursor-pointer select-none items-center gap-1.5", className)}>
      <span className="relative inline-flex size-4 shrink-0">
        <input type="radio" name={name} className="peer absolute inset-0 cursor-pointer opacity-0" checked={checked} onChange={() => onChange?.()} />
        <span
          className={cn(
            "flex size-full items-center justify-center rounded-full border shadow-input",
            checked ? "border-radio-on bg-radio-on" : "border-line bg-surface",
          )}
        >
          {checked && <span className="size-1.5 rounded-full bg-white" />}
        </span>
      </span>
      {label != null && <span className="text-sm font-medium text-fg">{label}</span>}
    </label>
  );
}

export function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
        checked ? "bg-radio-on" : "bg-btn-hover",
      )}
    >
      <span className={cn("inline-block size-4 rounded-full bg-white shadow transition-transform", checked ? "translate-x-[18px]" : "translate-x-0.5")} />
    </button>
  );
}

/** 잔여 10건 bar */
export function ProgressBar({ value, max, className }: { value: number; max: number; className?: string }) {
  const pct = max <= 0 ? 0 : Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-line-strong", className)}>
      <div className="h-full rounded-full bg-icon-2" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Avatar({ name, size = 40, color, className }: { name: string; size?: number; color?: string; className?: string }) {
  const ch = (name || "?").trim().charAt(0).toUpperCase();
  return (
    <span
      className={cn("inline-flex shrink-0 select-none items-center justify-center rounded-full text-avatar-fg", className)}
      style={{ width: size, height: size, background: color ?? "var(--avatar)", fontSize: Math.round(size * 0.45) }}
    >
      {ch}
    </span>
  );
}
