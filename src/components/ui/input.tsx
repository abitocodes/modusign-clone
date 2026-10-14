import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { ChevronDown, Search } from "lucide-react";

import { cn } from "@/lib/utils";

const base =
  "h-9 w-full rounded bg-surface px-3 text-sm text-fg shadow-input outline-none border border-transparent focus:border-emphasis focus:shadow-focus disabled:opacity-60";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  right?: ReactNode;
  left?: ReactNode;
  invalid?: boolean;
  wrapperClassName?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, right, left, invalid, wrapperClassName, ...props },
  ref,
) {
  if (!right && !left) {
    return <input ref={ref} className={cn(base, invalid && "border-negative", className)} {...props} />;
  }
  return (
    <div className={cn("relative w-full", wrapperClassName)}>
      {left && <div className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-fg-faint">{left}</div>}
      <input
        ref={ref}
        className={cn(base, left && "pl-9", right && "pr-10", invalid && "border-negative", className)}
        {...props}
      />
      {right && <div className="absolute inset-y-0 right-1 flex items-center">{right}</div>}
    </div>
  );
});

/** 제목으로 검색 — input with a magnifier button on the right */
export function SearchInput({
  className,
  onSearch,
  wrapperClassName,
  ...props
}: InputProps & { onSearch?: () => void }) {
  return (
    <Input
      wrapperClassName={wrapperClassName}
      className={className}
      onKeyDown={(e) => {
        if (e.key === "Enter") onSearch?.();
      }}
      right={
        <button
          type="button"
          aria-label="검색"
          className="flex h-8 w-9 items-center justify-center text-fg-faint hover:text-fg"
          onClick={() => onSearch?.()}
        >
          <Search className="size-[18px]" strokeWidth={2} />
        </button>
      }
      {...props}
    />
  );
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      className={cn(
        "w-full resize-none rounded border border-transparent bg-surface px-3 py-2 text-sm text-fg shadow-input outline-none focus:border-emphasis focus:shadow-focus",
        className,
      )}
      {...props}
    />
  );
});

/** Native select styled like the original (bg #212121, caret on the right). */
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { wrapperClassName?: string }>(
  function Select({ className, wrapperClassName, children, ...props }, ref) {
    return (
      <div className={cn("relative inline-flex", wrapperClassName)}>
        <select
          ref={ref}
          className={cn(
            "h-9 w-full appearance-none rounded border border-transparent bg-surface pl-3 pr-8 text-sm text-fg shadow-input outline-none focus:border-emphasis",
            className,
          )}
          {...props}
        >
          {children}
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-icon-2"
          strokeWidth={3}
        />
      </div>
    );
  },
);

/**
 * Outlined text field with floating label (참여자 설정 화면의 이름/이메일 입력).
 */
export const TextField = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { label: string; right?: ReactNode; wrapperClassName?: string; invalid?: boolean }
>(function TextField({ label, right, wrapperClassName, className, invalid, id, ...props }, ref) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <div className={cn("group relative", wrapperClassName)}>
      <input
        ref={ref}
        id={inputId}
        placeholder=" "
        className={cn(
          "peer h-14 w-full rounded-lg border border-line bg-transparent px-3.5 pt-1 text-base text-fg outline-none transition-colors focus:border-emphasis",
          invalid && "border-negative focus:border-negative",
          right && "pr-24",
          className,
        )}
        {...props}
      />
      <label
        htmlFor={inputId}
        className={cn(
          "pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 bg-surface px-1 text-base text-fg-muted transition-all",
          "peer-focus:top-0 peer-focus:text-[11px] peer-focus:text-emphasis",
          "peer-[:not(:placeholder-shown)]:top-0 peer-[:not(:placeholder-shown)]:text-[11px]",
        )}
      >
        {label}
      </label>
      {right && <div className="absolute inset-y-0 right-3 flex items-center">{right}</div>}
    </div>
  );
});

/** Filled text field (요청 정보: 문서 제목) */
export function FilledField({
  label,
  value,
  onChange,
  maxLength = 100,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  maxLength?: number;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="block rounded-t bg-surface-4 px-3 pb-1.5 pt-2 focus-within:[&+div]:bg-emphasis">
        <span className="block text-[11px] text-fg-muted">{label}</span>
        <input
          value={value}
          maxLength={maxLength}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-transparent text-base text-fg outline-none"
        />
      </label>
      <div className="h-px bg-fg-disabled" />
      <p className="mt-1 text-right text-[11px] text-fg-muted">
        {value.length}/{maxLength}
      </p>
    </div>
  );
}
