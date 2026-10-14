/**
 * 내부결재 / 결재선 — shared types and status helpers (client + server).
 * Columns added by supabase/migrations/20261014016000_tools_approvals.sql are typed here.
 */
import type { Approval, ApprovalLine, Approver } from "@/lib/types";
import type { BadgeTone } from "@/lib/utils";

export const APPROVER_LIMIT = 10;
export const LINE_NAME_LIMIT = 30;
export const APPROVAL_TITLE_LIMIT = 100;
export const APPROVAL_MESSAGE_LIMIT = 500;
export const APPROVAL_COMMENT_LIMIT = 500;

export interface ApprovalRecord extends Approval {
  message: string | null;
  page_count: number;
  line_id: string | null;
  completed_at: string | null;
}

export interface PersonRef {
  id: string;
  name: string;
  email: string;
}

export interface ApprovalListItem extends ApprovalRecord {
  drafter: PersonRef | null;
}

export interface ApprovalLineRecord extends ApprovalLine {
  last_activity_at: string;
}

export type ApprovalEventType = "submitted" | "approved" | "rejected" | "cancelled" | "completed";

export interface ApprovalEventRow {
  id: string;
  approval_id: string;
  type: ApprovalEventType;
  actor_id: string | null;
  actor_name: string | null;
  actor_email: string | null;
  comment: string | null;
  created_at: string;
}

/** Workspace member that can be picked as an approver. */
export interface MemberOption {
  id: string;
  name: string;
  email: string;
  department: string | null;
  position: string | null;
}

export function memberLabel(m: Pick<MemberOption, "name" | "email" | "department" | "position">) {
  const org = [m.department, m.position].filter(Boolean).join(" ");
  return `${m.name}${org ? ` · ${org}` : ""} (${m.email})`;
}

/* ---------------------------------------------------------------- status */

export type ApprovalStage = "waiting" | "in_progress" | "approved" | "rejected" | "cancelled";
export type ApprovalFilter = "all" | ApprovalStage;

export const APPROVAL_FILTER_OPTIONS: { value: ApprovalFilter; label: string }[] = [
  { value: "all", label: "모든 상태" },
  { value: "waiting", label: "결재 대기" },
  { value: "in_progress", label: "결재 진행 중" },
  { value: "approved", label: "결재 완료" },
  { value: "rejected", label: "반려" },
  { value: "cancelled", label: "기안 취소" },
];

export const STAGE_LABEL: Record<ApprovalStage, string> = {
  waiting: "결재 대기",
  in_progress: "결재 진행 중",
  approved: "결재 완료",
  rejected: "반려",
  cancelled: "기안 취소",
};

/**
 * 결재 대기 = 상신 후 아직 아무도 결재하지 않음, 결재 진행 중 = 일부 결재자가 승인함.
 */
export function approvalStage(a: Pick<Approval, "status" | "approvers">): ApprovalStage {
  switch (a.status) {
    case "approved":
      return "approved";
    case "rejected":
      return "rejected";
    case "cancelled":
      return "cancelled";
    default:
      return a.approvers.some((p) => p.status === "approved") ? "in_progress" : "waiting";
  }
}

export function currentApprover(a: Pick<Approval, "status" | "approvers">): { index: number; approver: Approver } | null {
  if (a.status !== "in_progress" && a.status !== "pending") return null;
  const index = a.approvers.findIndex((p) => p.status === "pending");
  return index < 0 ? null : { index, approver: a.approvers[index] };
}

export function isMyTurn(a: Pick<Approval, "status" | "approvers">, userId: string) {
  return currentApprover(a)?.approver.user_id === userId;
}

export function approvalBadge(a: Pick<Approval, "status" | "approvers">, userId: string): { label: string; tone: BadgeTone } {
  const stage = approvalStage(a);
  switch (stage) {
    case "approved":
      return { label: STAGE_LABEL.approved, tone: "positive" };
    case "rejected":
      return { label: STAGE_LABEL.rejected, tone: "negative" };
    case "cancelled":
      return { label: STAGE_LABEL.cancelled, tone: "neutral" };
    default:
      return { label: STAGE_LABEL[stage], tone: isMyTurn(a, userId) ? "warning" : "emphasis" };
  }
}

export const APPROVER_STATUS_LABEL: Record<NonNullable<Approver["status"]>, string> = {
  waiting: "대기",
  pending: "결재 중",
  approved: "승인",
  rejected: "반려",
};

/** Human readable sentence for the 진행 이력 list. */
export function describeApprovalEvent(e: Pick<ApprovalEventRow, "type" | "actor_name">) {
  const who = e.actor_name ?? "알 수 없음";
  switch (e.type) {
    case "submitted":
      return `${who} 님이 결재를 요청하였습니다.`;
    case "approved":
      return `${who} 님이 승인하였습니다.`;
    case "rejected":
      return `${who} 님이 반려하였습니다.`;
    case "cancelled":
      return `${who} 님이 기안을 취소하였습니다.`;
    case "completed":
      return "모든 결재자의 승인으로 결재가 완료되었습니다.";
    default:
      return who;
  }
}
