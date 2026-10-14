import "server-only";

import { appUrl, sendMail } from "@/lib/email/mailer";
import { emailLayout, koreanDeadline } from "@/lib/email/templates";
import type { Approver } from "@/lib/types";

export const approvalDetailPath = (wid: string, id: string) => `/workspaces/${wid}/esign/requests/approvals/${id}`;

const lineText = (approvers: Pick<Approver, "name">[]) => approvers.map((a, i) => `${i + 1}. ${a.name}`).join("  →  ");

/** 결재 요청 — to the approver whose turn it is. */
export async function mailApprovalRequest(p: {
  wid: string;
  approvalId: string;
  title: string;
  drafter: { name: string; email: string };
  to: Pick<Approver, "name" | "email">;
  approvers: Pick<Approver, "name">[];
  message?: string | null;
}) {
  const rows = [
    { label: "기안 제목", value: [p.title] },
    { label: "기안자", value: [`${p.drafter.name} (${p.drafter.email})`] },
    { label: "결재선", value: [lineText(p.approvers)] },
  ];
  if (p.message) rows.push({ label: "기안 의견", value: [p.message] });
  return sendMail({
    to: p.to.email,
    toName: p.to.name,
    kind: "approval",
    subject: `[결재요청] '${p.drafter.name}'님이 '${p.title}' 결재를 요청했습니다.`,
    html: emailLayout({
      heading: "결재할 차례입니다.",
      lead: [`${p.to.name}님, 내부결재 문서가 도착했습니다.`, "아래 버튼을 눌러 문서를 확인하고 승인 또는 반려해 주세요."],
      rows,
      cta: { label: "결재 문서 확인하기", href: appUrl(approvalDetailPath(p.wid, p.approvalId)) },
    }),
  });
}

/** 결재 완료 — to the drafter. */
export async function mailApprovalCompleted(p: {
  wid: string;
  approvalId: string;
  title: string;
  to: { name: string; email: string };
  approvers: Pick<Approver, "name">[];
  completedAt: string;
}) {
  return sendMail({
    to: p.to.email,
    toName: p.to.name,
    kind: "approval",
    subject: `[결재완료] '${p.title}' 결재가 완료되었습니다.`,
    html: emailLayout({
      heading: "결재가 완료되었습니다.",
      lead: ["모든 결재자가 기안 문서를 승인했습니다.", "아래 버튼에서 결재 내역을 확인할 수 있습니다."],
      rows: [
        { label: "기안 제목", value: [p.title] },
        { label: "결재선", value: [lineText(p.approvers)] },
        { label: "완료 일시", value: [koreanDeadline(p.completedAt)] },
      ],
      cta: { label: "결재 내역 확인하기", href: appUrl(approvalDetailPath(p.wid, p.approvalId)) },
    }),
  });
}

/** 반려 — to the drafter. */
export async function mailApprovalRejected(p: {
  wid: string;
  approvalId: string;
  title: string;
  to: { name: string; email: string };
  rejecterName: string;
  reason: string;
}) {
  return sendMail({
    to: p.to.email,
    toName: p.to.name,
    kind: "approval",
    subject: `[결재반려] '${p.rejecterName}'님이 '${p.title}' 기안을 반려했습니다.`,
    html: emailLayout({
      heading: "기안이 반려되었습니다.",
      lead: [`${p.rejecterName}님이 기안 문서를 반려했습니다.`, "반려 사유를 확인하고 필요하면 문서를 수정해 다시 기안해 주세요."],
      rows: [
        { label: "기안 제목", value: [p.title] },
        { label: "반려한 사람", value: [p.rejecterName] },
        { label: "반려 사유", value: [p.reason || "-"] },
      ],
      cta: { label: "결재 내역 확인하기", href: appUrl(approvalDetailPath(p.wid, p.approvalId)) },
    }),
  });
}

/** 기안 취소 — to the approver who was waiting to act. */
export async function mailApprovalCancelled(p: { title: string; to: Pick<Approver, "name" | "email">; drafterName: string }) {
  return sendMail({
    to: p.to.email,
    toName: p.to.name,
    kind: "approval",
    subject: `[기안취소] '${p.title}' 결재 요청이 취소되었습니다.`,
    html: emailLayout({
      heading: "결재 요청이 취소되었습니다.",
      lead: [`${p.drafterName}님이 기안을 취소했습니다.`, "이 문서는 더 이상 결재하지 않아도 됩니다."],
      rows: [
        { label: "기안 제목", value: [p.title] },
        { label: "기안자", value: [p.drafterName] },
      ],
    }),
  });
}
