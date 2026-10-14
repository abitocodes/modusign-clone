import { Check, ChevronRight, X } from "lucide-react";
import { Fragment } from "react";

import { StatusBadge } from "@/components/ui/badge";
import { approvalBadge } from "@/lib/tools/approvals";
import type { Approval, Approver } from "@/lib/types";
import { cn } from "@/lib/utils";

export function ApprovalStatusBadge({ approval, userId, className }: { approval: Pick<Approval, "status" | "approvers">; userId: string; className?: string }) {
  const b = approvalBadge(approval, userId);
  return (
    <StatusBadge tone={b.tone} className={className}>
      {b.label}
    </StatusBadge>
  );
}

const trailColor: Record<NonNullable<Approver["status"]>, string> = {
  approved: "text-positive",
  rejected: "text-negative",
  pending: "text-warning font-medium",
  waiting: "text-fg-muted",
};

/** "김민수 ✓ › 이서연 › 박지훈" — approver names coloured by their state. */
export function ApproverTrail({ approvers, className }: { approvers: Pick<Approver, "user_id" | "name" | "status">[]; className?: string }) {
  if (approvers.length === 0) return <span className={cn("text-xs text-fg-disabled", className)}>결재자 없음</span>;
  return (
    <span className={cn("flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 text-xs", className)}>
      {approvers.map((a, i) => (
        <Fragment key={`${a.user_id}-${i}`}>
          {i > 0 && <ChevronRight aria-hidden className="size-3 shrink-0 text-fg-disabled" />}
          <span className={cn("inline-flex items-center gap-0.5 whitespace-nowrap", trailColor[a.status ?? "waiting"])}>
            {a.name}
            {a.status === "approved" && <Check aria-label="승인" className="size-3" strokeWidth={3} />}
            {a.status === "rejected" && <X aria-label="반려" className="size-3" strokeWidth={3} />}
          </span>
        </Fragment>
      ))}
    </span>
  );
}

/**
 * Seal-like mark drawn in the 결재란: round seal for 승인 / 기안, square seal for 반려.
 * Original CSS drawing (no images).
 */
export function ApprovalSeal({ kind, name }: { kind: "approved" | "rejected" | "drafted"; name: string }) {
  const label = kind === "approved" ? "승인" : kind === "rejected" ? "반려" : "기안";
  return (
    <span
      role="img"
      aria-label={`${name} ${label}`}
      className={cn(
        "relative flex size-[54px] -rotate-[10deg] flex-col items-center justify-center border-2 leading-none",
        kind === "rejected" ? "rounded-[6px]" : "rounded-full",
        kind === "drafted" ? "border-emphasis text-emphasis" : "border-negative text-negative",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute inset-[3px] border",
          kind === "rejected" ? "rounded-[3px]" : "rounded-full",
          kind === "drafted" ? "border-emphasis/60" : "border-negative/60",
        )}
      />
      <span className="text-[13px] font-extrabold tracking-[2px]">{label}</span>
      <span className="mt-[3px] max-w-[42px] truncate text-[9px] font-bold">{name}</span>
    </span>
  );
}
