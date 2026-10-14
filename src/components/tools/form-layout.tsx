import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Form layout of the 새 연락처 / 맞춤 입력란 / 결재선 dialogs:
 * sections separated by 1px dividers, rows = label column (108px) + control column (480px).
 */
export function FormSection({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn("border-b border-line px-3 py-5 last:border-b-0", className)}>{children}</section>;
}

export function RequiredMark() {
  return (
    <span aria-hidden className="text-negative">
      *
    </span>
  );
}

export function FormRow({
  label,
  htmlFor,
  required,
  children,
  hint,
  className,
  align = "start",
}: {
  label: ReactNode;
  htmlFor?: string;
  required?: boolean;
  children: ReactNode;
  hint?: ReactNode;
  className?: string;
  align?: "center" | "start";
}) {
  return (
    <div className={cn("flex", align === "center" ? "items-center" : "items-start", className)}>
      <label
        htmlFor={htmlFor}
        className={cn("w-[108px] shrink-0 pr-3 text-sm font-medium leading-[18px] text-fg", align === "start" && "pt-[9px]")}
      >
        {label}
        {required && <RequiredMark />}
      </label>
      <div className="min-w-0 flex-1">
        {children}
        {hint}
      </div>
    </div>
  );
}

export function FieldError({ children, id }: { children?: ReactNode; id?: string }) {
  if (!children) return null;
  return (
    <p id={id} role="alert" className="mt-1.5 text-xs text-negative">
      {children}
    </p>
  );
}

export function Counter({ value, max, className }: { value: number; max: number; className?: string }) {
  return (
    <p className={cn("mt-1 text-right text-xs text-fg-muted", value > max && "text-negative", className)}>
      {value}/{max}
    </p>
  );
}
