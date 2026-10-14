import type { ButtonHTMLAttributes, ReactNode } from "react";

import { StatusBadge } from "@/components/ui/badge";
import type { MemberRole } from "@/lib/types";
import { cn } from "@/lib/utils";

import { ROLE_LABEL, ROLE_TONE } from "./shared";

/** Centred content card of the settings main area (bg #212121, bd #474747, rad 12, p 30). */
export function SettingsCard({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn("mb-3 rounded-xl border border-line bg-surface p-[30px]", className)}>{children}</section>;
}

export function CardTitle({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-4", className)}>
      <div className="min-w-0">
        <h2 className="text-xl font-bold text-fg">{title}</h2>
        {description && <p className="mt-1.5 text-[13px] leading-relaxed text-fg-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

/** label (13px/500 #a3a3a3, w108) + value (14px #e8e8e8) row of 기본 정보 / 내 멤버 정보. */
export function InfoRow({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-h-[38px] items-center", className)}>
      <dt className="flex w-[108px] shrink-0 items-center gap-1 text-[13px] font-medium text-fg-muted">{label}</dt>
      <dd className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-fg">{children}</dd>
    </div>
  );
}

/** Underlined text button: "변경", "워크스페이스 삭제" */
export function TextButton({ className, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex items-center gap-1 text-sm text-fg-muted underline decoration-fg-muted underline-offset-[3px] hover:text-fg-2 disabled:cursor-default disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function RoleBadge({ role, className }: { role: MemberRole; className?: string }) {
  return (
    <StatusBadge tone={ROLE_TONE[role]} dot={false} className={className}>
      {ROLE_LABEL[role]}
    </StatusBadge>
  );
}

/** Two-column form row used in settings dialogs (label column 108px, like the 새 연락처 modal). */
export function FormRow({
  label,
  required,
  htmlFor,
  hint,
  error,
  children,
  className,
}: {
  label: ReactNode;
  required?: boolean;
  htmlFor?: string;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start gap-3", className)}>
      <label htmlFor={htmlFor} className="flex h-9 w-[108px] shrink-0 items-center text-sm font-medium text-fg">
        {label}
        {required && <span className="ml-0.5 text-negative">*</span>}
      </label>
      <div className="min-w-0 flex-1">
        {children}
        {error ? (
          <p role="alert" className="mt-1.5 text-xs text-negative">
            {error}
          </p>
        ) : (
          hint && <p className="mt-1.5 text-xs text-fg-muted">{hint}</p>
        )}
      </div>
    </div>
  );
}

export function Divider({ className }: { className?: string }) {
  return <div className={cn("h-px bg-line", className)} />;
}

/** Placeholder card for menus that are not implemented yet. */
export function ComingSoonCard({ title, description }: { title: string; description?: string }) {
  return (
    <SettingsCard>
      <CardTitle title={title} description={description} />
      <div className="mt-8 flex flex-col items-center justify-center rounded-lg border border-line-light bg-surface-2 px-6 py-14 text-center">
        <ComingSoonArt />
        <p className="mt-5 text-base font-bold text-fg-2">준비 중인 기능입니다.</p>
        <p className="mt-1.5 text-[13px] text-fg-muted">더 나은 서비스를 위해 기능을 준비하고 있어요.</p>
      </div>
    </SettingsCard>
  );
}

/** Original simple illustration: a gear and a wrench over a card. */
function ComingSoonArt() {
  return (
    <svg width="112" height="84" viewBox="0 0 112 84" aria-hidden>
      <rect x="14" y="14" width="84" height="58" rx="8" fill="var(--surface-4)" stroke="var(--line-strong)" />
      <rect x="24" y="26" width="40" height="6" rx="3" fill="var(--line-strong)" />
      <rect x="24" y="38" width="28" height="6" rx="3" fill="var(--line)" />
      <rect x="24" y="50" width="34" height="6" rx="3" fill="var(--line)" />
      <g transform="translate(80 50)">
        <circle r="15" fill="var(--warning-bg)" stroke="var(--warning)" strokeWidth="2" />
        <circle r="8" fill="none" stroke="var(--warning)" strokeWidth="4" strokeDasharray="3.14 3.14" />
        <circle r="6" fill="var(--warning)" />
        <circle r="2.6" fill="var(--warning-bg)" />
      </g>
    </svg>
  );
}

/** Original illustration for empty lists (people silhouettes). */
export function EmptyPeopleArt({ className }: { className?: string }) {
  return (
    <svg width="96" height="72" viewBox="0 0 96 72" className={className} aria-hidden>
      <circle cx="34" cy="26" r="11" fill="var(--line-strong)" />
      <path d="M14 60c0-11 9-19 20-19s20 8 20 19z" fill="var(--line-strong)" />
      <circle cx="62" cy="22" r="9" fill="var(--line)" />
      <path d="M46 52c1.5-9 8-15 16-15s16 6.5 16 16z" fill="var(--line)" />
      <circle cx="74" cy="54" r="10" fill="var(--emphasis-bg)" stroke="var(--emphasis)" strokeWidth="2" />
      <path d="M74 49v10M69 54h10" stroke="var(--emphasis)" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

/** Generic "nothing here" box. */
export function EmptyState({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <EmptyPeopleArt />
      <p className="mt-4 text-sm font-medium text-fg-2">{title}</p>
      {description && <p className="mt-1 text-[13px] leading-relaxed text-fg-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** Shown on admin-only pages to regular members. */
export function AdminOnlyNotice({ title }: { title: string }) {
  return (
    <SettingsCard>
      <CardTitle title={title} />
      <div className="mt-6 rounded-lg border border-warning-border bg-warning-bg px-5 py-4 text-[13px] text-fg-2">
        최고 관리자 또는 관리자만 확인할 수 있는 메뉴입니다.
      </div>
    </SettingsCard>
  );
}
