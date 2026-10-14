import { Check } from "lucide-react";
import type { ReactNode } from "react";

import type { BadgeTone } from "@/lib/utils";
import { cn } from "@/lib/utils";

const tones: Record<BadgeTone, string> = {
  emphasis: "bg-emphasis-bg border-emphasis-border text-emphasis",
  warning: "bg-warning-bg border-warning-border text-warning",
  positive: "bg-positive-bg border-positive-border text-positive",
  negative: "bg-negative-bg border-negative-border text-negative",
  neutral: "bg-neutral-badge-bg border-neutral-badge-border text-neutral-badge-text",
};

/** Document status badge (h22, rad4, small dot; completed/positive shows a check mark) */
export function StatusBadge({ tone, children, dot = true, className }: { tone: BadgeTone; children: ReactNode; dot?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex h-[22px] items-center gap-1 whitespace-nowrap rounded border px-2 text-xs font-medium", tones[tone], className)}>
      {dot &&
        (tone === "positive" ? (
          <Check className="size-3" strokeWidth={3} />
        ) : (
          <span className="size-1.5 rounded-full bg-current" />
        ))}
      {children}
    </span>
  );
}

/** Rounded pill chip: "전체" / "내 템플릿" filter chips at the page title */
export function FilterChip({ active, children, onClick }: { active?: boolean; children: ReactNode; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-7 rounded-full border px-2.5 text-[13px] font-medium transition-colors",
        active ? "border-fg-3 bg-line-light text-white" : "border-line-light bg-surface-3 text-fg-muted hover:text-fg-2",
      )}
    >
      {children}
    </button>
  );
}

/** Small count pill "0개" */
export function CountPill({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex h-5 items-center rounded-full border border-line-strong bg-surface-3 px-2 text-[13px] font-medium text-fg-muted", className)}>
      {children}
    </span>
  );
}

/** rounded-full chip: 서명자 1 / 기본 / 개인 / 서명 / 열람 */
export function Chip({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: "neutral" | "emphasis" | "outline";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-[22px] items-center rounded-full border px-2 text-xs font-medium",
        tone === "neutral" && "border-line-light bg-surface-4 text-fg",
        tone === "emphasis" && "border-emphasis-border bg-emphasis-bg text-emphasis",
        tone === "outline" && "border-emphasis-border text-emphasis",
        className,
      )}
    >
      {children}
    </span>
  );
}
