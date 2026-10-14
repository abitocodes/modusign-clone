"use server";

import { revalidatePath } from "next/cache";

import { BUCKET, MAX_PDF_BYTES, paths } from "@/lib/storage";
import { approvalDetailPath, mailApprovalCancelled, mailApprovalCompleted, mailApprovalRejected, mailApprovalRequest } from "@/lib/tools/approval-mail";
import {
  APPROVAL_COMMENT_LIMIT,
  APPROVAL_MESSAGE_LIMIT,
  APPROVAL_TITLE_LIMIT,
  APPROVER_LIMIT,
  currentApprover,
  type ApprovalRecord,
} from "@/lib/tools/approvals";
import { isUuid, type ActionResult } from "@/lib/tools/result";
import { dbErrorMessage, requireMember, type ServerSupabase } from "@/lib/tools/server";
import type { Approver } from "@/lib/types";

const listPath = (wid: string) => `/workspaces/${wid}/esign/requests/approvals`;

async function profileOf(supabase: ServerSupabase, id: string) {
  const { data } = await supabase.from("profiles").select("name, email").eq("id", id).maybeSingle();
  return (data as { name: string; email: string } | null) ?? null;
}

async function loadApproval(supabase: ServerSupabase, wid: string, id: string) {
  const { data } = await supabase.from("approvals").select("*").eq("id", id).eq("workspace_id", wid).maybeSingle();
  return (data as ApprovalRecord | null) ?? null;
}

/* ------------------------------------------------------------ 기안 상신 */

export interface SubmitApprovalInput {
  /** client generated id — the PDF was uploaded to paths.approval(wid, id) */
  id: string;
  title: string;
  fileName: string;
  pageCount: number;
  message: string;
  approverIds: string[];
  lineId: string | null;
}

export async function submitApproval(wid: string, input: SubmitApprovalInput): Promise<ActionResult<{ id: string }>> {
  const guard = await requireMember(wid);
  if (!guard.ok) return guard;
  const { supabase, userId } = guard;

  if (!isUuid(input?.id)) return { ok: false, error: "잘못된 요청입니다." };
  const title = String(input.title ?? "").trim();
  if (!title) return { ok: false, error: "기안 제목을 입력해 주세요." };
  if (title.length > APPROVAL_TITLE_LIMIT) return { ok: false, error: `기안 제목은 ${APPROVAL_TITLE_LIMIT}자 이내로 입력해 주세요.` };
  const message = String(input.message ?? "").trim();
  if (message.length > APPROVAL_MESSAGE_LIMIT) return { ok: false, error: `기안 의견은 ${APPROVAL_MESSAGE_LIMIT}자 이내로 입력해 주세요.` };
  const ids = Array.isArray(input.approverIds) ? input.approverIds : [];
  if (ids.length === 0) return { ok: false, error: "결재자를 한 명 이상 지정해 주세요." };
  if (ids.length > APPROVER_LIMIT) return { ok: false, error: `결재자는 최대 ${APPROVER_LIMIT}명까지 지정할 수 있습니다.` };
  if (!ids.every(isUuid)) return { ok: false, error: "결재자를 모두 선택해 주세요." };
  if (new Set(ids).size !== ids.length) return { ok: false, error: "같은 결재자가 중복으로 지정되었습니다." };
  if (ids.includes(userId)) return { ok: false, error: "기안자 본인은 결재자로 지정할 수 없습니다." };
  const lineId = input.lineId && isUuid(input.lineId) ? input.lineId : null;
  const pageCount = Math.max(1, Math.min(5000, Math.floor(Number(input.pageCount) || 1)));
  const fileName =
    Array.from(String(input.fileName ?? ""))
      .filter((ch) => ch.charCodeAt(0) >= 32)
      .join("")
      .replace(/[\\/:*?"<>|]/g, "_")
      .trim()
      .slice(0, 200) || `${title}.pdf`;

  // the uploaded object must be a PDF within the size limit
  const filePath = paths.approval(wid, input.id);
  const { data: objects } = await supabase.storage.from(BUCKET).list(`${wid}/approvals`, { search: `${input.id}.pdf`, limit: 1 });
  const object = objects?.find((o) => o.name === `${input.id}.pdf`);
  if (!object) return { ok: false, error: "업로드한 PDF 파일을 찾을 수 없습니다. 다시 업로드해 주세요." };
  const meta = (object.metadata ?? {}) as { mimetype?: string; size?: number };
  if (meta.mimetype && meta.mimetype !== "application/pdf") return { ok: false, error: "PDF 파일만 기안할 수 있습니다." };
  if (typeof meta.size === "number" && meta.size > MAX_PDF_BYTES) return { ok: false, error: "10MB 이하의 PDF 파일만 기안할 수 있습니다." };

  const { data, error } = await supabase.rpc("approval_submit", {
    p_id: input.id,
    p_workspace_id: wid,
    p_title: title,
    p_file_name: fileName,
    p_file_path: filePath,
    p_page_count: pageCount,
    p_message: message || null,
    p_approver_ids: ids,
    p_line_id: lineId,
  });
  if (error || !data) return { ok: false, error: dbErrorMessage(error, "결재를 요청하지 못했습니다. 잠시 후 다시 시도해 주세요.") };

  const row = data as ApprovalRecord;
  const first = row.approvers[0];
  const drafter = (await profileOf(supabase, userId)) ?? { name: "기안자", email: guard.email };
  if (first) {
    await mailApprovalRequest({
      wid,
      approvalId: row.id,
      title: row.title,
      drafter,
      to: first,
      approvers: row.approvers,
      message: row.message,
    });
  }

  revalidatePath(listPath(wid));
  revalidatePath(`/workspaces/${wid}/esign/requests/approval-processes`);
  return { ok: true, id: row.id };
}

/* ------------------------------------------------------------ 승인 / 반려 */

export async function decideApproval(
  wid: string,
  id: string,
  decision: "approve" | "reject",
  comment: string,
): Promise<ActionResult<{ status: ApprovalRecord["status"] }>> {
  const guard = await requireMember(wid);
  if (!guard.ok) return guard;
  const { supabase, userId } = guard;
  if (!isUuid(id) || (decision !== "approve" && decision !== "reject")) return { ok: false, error: "잘못된 요청입니다." };
  const text = String(comment ?? "").trim();
  if (text.length > APPROVAL_COMMENT_LIMIT) return { ok: false, error: `의견은 ${APPROVAL_COMMENT_LIMIT}자 이내로 입력해 주세요.` };
  if (decision === "reject" && !text) return { ok: false, error: "반려 사유를 입력해 주세요." };

  const before = await loadApproval(supabase, wid, id);
  if (!before) return { ok: false, error: "기안 문서를 찾을 수 없습니다." };

  const { data, error } = await supabase.rpc("approval_decide", {
    p_id: id,
    p_approve: decision === "approve",
    p_comment: text || null,
  });
  if (error || !data) return { ok: false, error: dbErrorMessage(error, "결재를 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.") };

  const result = data as { status: ApprovalRecord["status"]; next: Approver | null; title: string; drafter_id: string };
  const after = (await loadApproval(supabase, wid, id)) ?? before;
  const drafter = await profileOf(supabase, result.drafter_id);
  const me = (await profileOf(supabase, userId)) ?? { name: "결재자", email: guard.email };

  if (result.next) {
    if (drafter) {
      await mailApprovalRequest({
        wid,
        approvalId: id,
        title: result.title,
        drafter,
        to: result.next,
        approvers: after.approvers,
        message: after.message,
      });
    }
  } else if (result.status === "approved" && drafter) {
    await mailApprovalCompleted({
      wid,
      approvalId: id,
      title: result.title,
      to: drafter,
      approvers: after.approvers,
      completedAt: after.completed_at ?? new Date().toISOString(),
    });
  } else if (result.status === "rejected" && drafter) {
    await mailApprovalRejected({ wid, approvalId: id, title: result.title, to: drafter, rejecterName: me.name, reason: text });
  }

  revalidatePath(listPath(wid));
  revalidatePath(approvalDetailPath(wid, id));
  return { ok: true, status: result.status };
}

/* ------------------------------------------------------------ 기안 취소 */

export async function cancelApproval(wid: string, id: string): Promise<ActionResult> {
  const guard = await requireMember(wid);
  if (!guard.ok) return guard;
  const { supabase, userId } = guard;
  if (!isUuid(id)) return { ok: false, error: "잘못된 요청입니다." };

  const row = await loadApproval(supabase, wid, id);
  if (!row) return { ok: false, error: "기안 문서를 찾을 수 없습니다." };
  if (row.drafter_id !== userId) return { ok: false, error: "기안자만 기안을 취소할 수 있습니다." };
  const waiting = currentApprover(row)?.approver ?? null;

  const { error } = await supabase.rpc("approval_cancel", { p_id: id });
  if (error) return { ok: false, error: dbErrorMessage(error, "기안을 취소하지 못했습니다. 잠시 후 다시 시도해 주세요.") };

  if (waiting) {
    const me = (await profileOf(supabase, userId)) ?? { name: "기안자", email: guard.email };
    await mailApprovalCancelled({ title: row.title, to: waiting, drafterName: me.name });
  }

  revalidatePath(listPath(wid));
  revalidatePath(approvalDetailPath(wid, id));
  return { ok: true };
}

/* ------------------------------------------------------------ 삭제 */

export async function deleteApproval(wid: string, id: string): Promise<ActionResult> {
  const guard = await requireMember(wid);
  if (!guard.ok) return guard;
  const { supabase, userId } = guard;
  if (!isUuid(id)) return { ok: false, error: "잘못된 요청입니다." };

  const row = await loadApproval(supabase, wid, id);
  if (!row) return { ok: false, error: "기안 문서를 찾을 수 없습니다." };
  if (row.drafter_id !== userId) return { ok: false, error: "기안자만 삭제할 수 있습니다." };
  if (row.status !== "rejected" && row.status !== "cancelled") {
    return { ok: false, error: "반려되었거나 취소된 기안만 삭제할 수 있습니다." };
  }

  const { data, error } = await supabase.from("approvals").delete().eq("id", id).eq("workspace_id", wid).select("id");
  if (error || !data || data.length === 0) return { ok: false, error: "기안을 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  if (row.file_path) await supabase.storage.from(BUCKET).remove([row.file_path]);

  revalidatePath(listPath(wid));
  return { ok: true };
}

/* ------------------------------------------------------------ 다운로드 */

export async function getApprovalDownloadUrl(wid: string, id: string): Promise<ActionResult<{ url: string }>> {
  const guard = await requireMember(wid);
  if (!guard.ok) return guard;
  if (!isUuid(id)) return { ok: false, error: "잘못된 요청입니다." };
  const row = await loadApproval(guard.supabase, wid, id);
  if (!row?.file_path) return { ok: false, error: "기안 문서를 찾을 수 없습니다." };
  const name = row.file_name || `${row.title}.pdf`;
  const { data, error } = await guard.supabase.storage.from(BUCKET).createSignedUrl(row.file_path, 60, { download: name });
  if (error || !data) return { ok: false, error: "다운로드 링크를 만들지 못했습니다. 잠시 후 다시 시도해 주세요." };
  return { ok: true, url: data.signedUrl };
}
