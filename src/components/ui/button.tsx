import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

import { cn } from "@/lib/utils";

export type ButtonVariant = "primary" | "neutral" | "light" | "outline" | "ghost" | "secondary" | "danger";
export type ButtonSize = "xs" | "sm" | "md" | "lg";

const variants: Record<ButtonVariant, string> = {
  // 서명 요청 시작하기 / 다음으로 / 즉시 전송
  primary:
    "bg-primary text-primary-fg hover:bg-primary-hover shadow-button disabled:bg-btn-disabled disabled:text-fg-disabled disabled:shadow-none",
  // + 템플릿 등록, + 문서 추가 …
  neutral: "bg-btn-dark text-fg-2 hover:bg-btn-hover disabled:bg-btn-disabled disabled:text-fg-disabled",
  // 이전 / 나가기 / 취소
  light: "bg-btn-light text-fg-2 hover:bg-btn-base shadow-button disabled:bg-btn-disabled disabled:text-fg-disabled",
  // 업로드 / 설정 / 변경 (outlined small)
  outline:
    "border border-line-strong bg-btn-light text-fg-2 hover:bg-btn-base disabled:text-fg-disabled disabled:hover:bg-btn-light",
  ghost: "text-fg-2 hover:bg-btn-light disabled:text-fg-disabled",
  // 만들기 (light grey)
  secondary: "bg-secondary text-secondary-fg hover:opacity-90 disabled:opacity-50",
  danger: "bg-negative-bg text-negative hover:brightness-110 border border-negative-border",
};

const sizes: Record<ButtonSize, string> = {
  xs: "h-7 px-2.5 text-[13px] rounded",
  sm: "h-8 px-3 text-[13px] rounded",
  md: "h-9 px-3.5 text-sm rounded",
  lg: "h-[42px] px-5 text-base rounded-md",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  iconRight?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "neutral", size = "md", icon, iconRight, className, children, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap font-medium transition-colors",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {icon}
      {children}
      {iconRight}
    </button>
  );
});

export function IconButton({
  className,
  children,
  label,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex size-10 shrink-0 items-center justify-center rounded-full text-icon transition-colors hover:bg-btn-light",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
