"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  canManage,
  getActor,
  isParticipantExpired,
  isUuid,
  loadOwners,
  loadProgressInfo,
  PARTICIPANT_COLUMNS,
  type Actor,
  type RawParticipant,
} from "@/lib/documents/server";
import { anyoneActed, CANCELLABLE_STATUSES, wizardHref, type ProgressInfo } from "@/lib/documents/view";
import { appUrl, sendMail } from "@/lib/email/mailer";
import { cancelledEmail, reminderEmail } from "@/lib/email/templates";
import { logEvent } from "@/lib/events";
import { BUCKET, paths } from "@/lib/storage";
import { createAdminClient } from "@/lib/supabase/admin";
import type { DocStatus, Label } from "@/lib/types";
import { PARTICIPANT_COLORS } from "@/lib/utils";

/**
 * Server actions of the 문서함 area (document list, row panel, kebab menu, viewer, reminders).
 * Every action re-checks membership + per-document permission on the server.
 */

export type ActionResult<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };

const NO_PERMISSION = "이 작업을 수행할 권한이 없습니다.";
const NOT_FOUND = "문서를 찾을 수 없습니다.";
const MAX_BATCH = 100;

function revalidateDocs(wid: string, docIds: string[] = []) {
  revalidatePath(`/workspaces/${wid}/esign/documents`, "layout");
  revalidatePath(`/workspaces/${wid}/esign/home`);
  for (const id of docIds) revalidatePath(`/workspaces/${wid}/documents/${id}`);
}

function uuidList(ids: unknown): string[] | null {
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_BATCH) return null;
  const list = [...new Set(ids)];
  return list.every(isUuid) ? (list as string[]) : null;
}

interface DocWithParticipants {
  id: string;
  title: string;
  status: DocStatus;
  owner_id: string;
  request_type: "sign" | "view";
  file_path: string | null;
  completed_file_path: string | null;
  label_ids: string[];
  participants: RawParticipant[];
}

async function loadDocs(actor: Actor, wid: string, ids: string[]): Promise<DocWithParticipants[]> {
  const { data } = await actor.supabase
    .from("documents")
    .select(`id, title, status, owner_id, request_type, file_path, completed_file_path, label_ids, participants(${PARTICIPANT_COLUMNS})`)
    .eq("workspace_id", wid)
    .in("id", ids);
  return (data ?? []) as DocWithParticipants[];
}

/* ------------------------------------------------------------ 진행 정보 */

export async function getProgressInfo(wid: string, docId: string): Promise<ActionResult<{ info: ProgressInfo }>> {
  const actor = await getActor(wid);
  if (!actor) return { ok: false, error: NO_PERMISSION };
  const info = await loadProgressInfo(actor.supabase, wid, docId, actor.userId);
  if (!info) return { ok: false, error: NOT_FOUND };
  return { ok: true, info };
}

/* ------------------------------------------------------------ 리마인드 */

/** Re-sends the sign request mail to every pending participant of the given in-progress documents. */
export async function sendReminders(wid: string, docIds: string[]): Promise<ActionResult<{ sent: number; documents: number }>> {
  const actor = await getActor(wid);
  const ids = uuidList(docIds);
  if (!actor) return { ok: false, error: NO_PERMISSION };
  if (!ids) return { ok: false, error: "선택한 문서가 올바르지 않습니다." };

  const docs = (await loadDocs(actor, wid, ids)).filter((d) => d.status === "in_progress" && canManage(d, actor));
  if (!docs.length) return { ok: false, error: "리마인드를 보낼 수 있는 진행 중 문서가 없습니다." };

  const targetsOf = (doc: DocWithParticipants, expired: boolean) =>
    doc.participants.filter(
      (p) => p.status === "pending" && !!p.email && p.delivery !== "in_person" && isParticipantExpired(p) === expired,
    );
  const targetIds = docs.flatMap((d) => targetsOf(d, false).map((p) => p.id));
  if (!targetIds.length) {
    return {
      ok: false,
      error: docs.some((d) => targetsOf(d, true).length)
        ? "서명 기한이 지난 서명자에게는 리마인드를 보낼 수 없습니다."
        : "리마인드를 보낼 서명자가 없습니다.",
    };
  }

  // sign links are not readable through the API: the requester / admin was authorised above
  const admin = createAdminClient();
  const { data: tokenRows, error: tokenError } = await admin.from("participants").select("id, access_token").in("id", targetIds);
  if (tokenError) return { ok: false, error: "리마인드를 보내지 못했습니다. 잠시 후 다시 시도해 주세요." };
  const tokens = new Map(((tokenRows ?? []) as { id: string; access_token: string }[]).map((r) => [r.id, r.access_token]));

  const owners = await loadOwners(actor.supabase, docs.map((d) => d.owner_id));
  let sent = 0;
  const touched: string[] = [];
  const reminded: string[] = [];
  for (const doc of docs) {
    const targets = targetsOf(doc, false).filter((p) => tokens.has(p.id));
    if (!targets.length) continue;
    const requester = owners.get(doc.owner_id);
    for (const p of targets) {
      const mail = reminderEmail({
        title: doc.title,
        requesterName: requester?.name ?? actor.name,
        signerName: p.name || p.email!,
        expiresAt: p.expires_at,
        link: appUrl(`/sign/${tokens.get(p.id)}`),
      });
      await sendMail({ to: p.email!, toName: p.name, subject: mail.subject, html: mail.html, kind: "reminder", documentId: doc.id });
      await logEvent(doc.id, "reminded", { name: p.name, email: p.email });
      reminded.push(p.id);
      sent++;
    }
    touched.push(doc.id);
  }
  if (!sent) return { ok: false, error: "리마인드를 보낼 서명자가 없습니다." };
  // the requester re-issued the request: a locked identity check (too many failures) opens again
  const { error: resetError } = await admin.from("participant_identity_attempts").delete().in("participant_id", reminded);
  if (resetError) console.error("[documents] identity counters not reset:", resetError.message);

  await actor.supabase.from("documents").update({ last_activity_at: new Date().toISOString() }).in("id", touched);
  revalidateDocs(wid, touched);
  return { ok: true, sent, documents: touched.length };
}

/* ------------------------------------------------------------ 숨기기 */

export async function setDocumentsHidden(wid: string, docIds: string[], hidden: boolean): Promise<ActionResult<{ count: number }>> {
  const actor = await getActor(wid);
  const ids = uuidList(docIds);
  if (!actor) return { ok: false, error: NO_PERMISSION };
  if (!ids || typeof hidden !== "boolean") return { ok: false, error: "요청이 올바르지 않습니다." };

  const allowed = (await loadDocs(actor, wid, ids)).filter((d) => canManage(d, actor)).map((d) => d.id);
  if (!allowed.length) return { ok: false, error: NO_PERMISSION };
  const { error } = await actor.supabase.from("documents").update({ hidden }).eq("workspace_id", wid).in("id", allowed);
  if (error) return { ok: false, error: "변경 사항을 저장하지 못했습니다." };
  revalidateDocs(wid, allowed);
  return { ok: true, count: allowed.length };
}

/* ------------------------------------------------------------ 라벨 */

export async function createLabel(wid: string, name: string, color?: string): Promise<ActionResult<{ label: Label }>> {
  const actor = await getActor(wid);
  if (!actor) return { ok: false, error: NO_PERMISSION };
  const trimmed = typeof name === "string" ? name.trim().replace(/\s+/g, " ") : "";
  if (!trimmed) return { ok: false, error: "라벨 이름을 입력하세요." };
  if (trimmed.length > 20) return { ok: false, error: "라벨 이름은 20자 이내로 입력하세요." };

  const { data: existing } = await actor.supabase.from("labels").select("*").eq("workspace_id", wid);
  const dup = ((existing ?? []) as Label[]).find((l) => l.name.toLowerCase() === trimmed.toLowerCase());
  if (dup) return { ok: true, label: dup };
  if ((existing ?? []).length >= 200) return { ok: false, error: "라벨은 최대 200개까지 만들 수 있습니다." };

  const safeColor =
    typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color)
      ? color
      : PARTICIPANT_COLORS[(existing ?? []).length % PARTICIPANT_COLORS.length];
  const { data, error } = await actor.supabase
    .from("labels")
    .insert({ workspace_id: wid, name: trimmed, color: safeColor })
    .select("*")
    .single();
  if (error || !data) return { ok: false, error: "라벨을 만들지 못했습니다." };
  revalidateDocs(wid);
  return { ok: true, label: data as Label };
}

export async function setDocumentLabels(wid: string, docId: string, labelIds: string[]): Promise<ActionResult> {
  const actor = await getActor(wid);
  if (!actor) return { ok: false, error: NO_PERMISSION };
  if (!isUuid(docId) || !Array.isArray(labelIds) || labelIds.length > 50 || !labelIds.every(isUuid)) {
    return { ok: false, error: "요청이 올바르지 않습니다." };
  }
  const [doc] = await loadDocs(actor, wid, [docId]);
  if (!doc) return { ok: false, error: NOT_FOUND };
  if (!canManage(doc, actor)) return { ok: false, error: NO_PERMISSION };

  let valid: string[] = [];
  if (labelIds.length) {
    const { data } = await actor.supabase.from("labels").select("id").eq("workspace_id", wid).in("id", [...new Set(labelIds)]);
    const ok = new Set(((data ?? []) as { id: string }[]).map((l) => l.id));
    valid = labelIds.filter((id, i) => ok.has(id) && labelIds.indexOf(id) === i);
  }
  const { error } = await actor.supabase.from("documents").update({ label_ids: valid }).eq("id", docId).eq("workspace_id", wid);
  if (error) return { ok: false, error: "라벨을 저장하지 못했습니다." };
  revalidateDocs(wid, [docId]);
  return { ok: true };
}

/* ------------------------------------------------------------ 서명 요청 취소 */

export async function cancelSignRequest(wid: string, docId: string, reason?: string): Promise<ActionResult> {
  const actor = await getActor(wid);
  if (!actor) return { ok: false, error: NO_PERMISSION };
  if (!isUuid(docId)) return { ok: false, error: NOT_FOUND };
  const why = typeof reason === "string" ? reason.trim().slice(0, 200) : "";

  const [doc] = await loadDocs(actor, wid, [docId]);
  if (!doc) return { ok: false, error: NOT_FOUND };
  if (!canManage(doc, actor)) return { ok: false, error: NO_PERMISSION };
  if (!CANCELLABLE_STATUSES.includes(doc.status)) {
    return { ok: false, error: "진행 중, 수정 중이거나 예약된 문서만 취소할 수 있습니다." };
  }

  // locks the document row: a signer's concurrent submit / reject and this cancel never both win
  const { data: verdict, error } = await actor.supabase.rpc("doc_cancel_request", { p_document_id: docId });
  if (error || verdict !== "ok") {
    if (verdict === "state") return { ok: false, error: "문서 상태가 변경되어 취소할 수 없습니다. 페이지를 새로고침해 주세요." };
    return { ok: false, error: verdict === "forbidden" ? NO_PERMISSION : "서명 요청을 취소하지 못했습니다." };
  }

  await logEvent(docId, "cancelled", { name: actor.name, email: actor.email }, { meta: why ? { reason: why } : {} });

  const notified = doc.participants.filter((p) => !!p.sent_at && !!p.email);
  const mail = cancelledEmail({ title: doc.title, requesterName: actor.name, reason: why || null });
  for (const p of notified) {
    await sendMail({ to: p.email!, toName: p.name, subject: mail.subject, html: mail.html, kind: "cancelled", documentId: docId });
  }
  revalidateDocs(wid, [docId]);
  return { ok: true };
}

/* ------------------------------------------------------------ 내용 수정 */

/** Puts an in-progress document back into the wizard (only while nobody has signed yet). */
export async function startModifyDocument(wid: string, docId: string): Promise<ActionResult<{ href: string }>> {
  const actor = await getActor(wid);
  if (!actor) return { ok: false, error: NO_PERMISSION };
  if (!isUuid(docId)) return { ok: false, error: NOT_FOUND };
  const [doc] = await loadDocs(actor, wid, [docId]);
  if (!doc) return { ok: false, error: NOT_FOUND };
  if (!canManage(doc, actor)) return { ok: false, error: NO_PERMISSION };

  const href = wizardHref(wid, docId);
  if (doc.status === "draft" || doc.status === "on_modifying") return { ok: true, href };
  if (doc.status !== "in_progress" && doc.status !== "scheduled") return { ok: false, error: "진행 중인 문서만 수정할 수 있습니다." };
  const actedError =
    doc.request_type === "view" ? "이미 열람한 참여자가 있어 내용을 수정할 수 없습니다." : "이미 서명한 참여자가 있어 내용을 수정할 수 없습니다.";
  if (anyoneActed(doc.participants)) return { ok: false, error: actedError };

  // the "nobody acted" check runs again inside the RPC, after locking the document row
  const { data: verdict, error } = await actor.supabase.rpc("doc_start_modify", { p_document_id: docId });
  if (error || verdict !== "ok") {
    if (verdict === "acted") return { ok: false, error: actedError };
    if (verdict === "forbidden") return { ok: false, error: NO_PERMISSION };
    return { ok: false, error: "문서를 수정 상태로 바꾸지 못했습니다." };
  }

  await logEvent(docId, "modified", { name: actor.name, email: actor.email });
  revalidateDocs(wid, [docId]);
  return { ok: true, href };
}

/* ------------------------------------------------------------ 직접 대면 서명 */

/**
 * 직접 대면 서명 시작: the requester (or an admin) opens the signing page of a pending 직접 대면
 * participant on this device. The link is resolved here and never placed in list data.
 */
export async function startInPersonSigning(wid: string, docId: string, participantId: string): Promise<ActionResult> {
  const actor = await getActor(wid);
  if (!actor) return { ok: false, error: NO_PERMISSION };
  if (!isUuid(docId) || !isUuid(participantId)) return { ok: false, error: NOT_FOUND };
  const [doc] = await loadDocs(actor, wid, [docId]);
  if (!doc) return { ok: false, error: NOT_FOUND };
  if (!canManage(doc, actor)) return { ok: false, error: NO_PERMISSION };
  if (doc.status !== "in_progress") return { ok: false, error: "진행 중인 문서만 서명할 수 있습니다." };
  const p = doc.participants.find((x) => x.id === participantId);
  if (!p || p.delivery !== "in_person") return { ok: false, error: "직접 대면 서명자가 아닙니다." };
  if (p.status !== "pending") return { ok: false, error: "아직 서명 차례가 아니거나 이미 서명한 참여자입니다." };
  if (isParticipantExpired(p)) return { ok: false, error: "서명 기한이 만료되었습니다." };

  const { data: row } = await createAdminClient()
    .from("participants")
    .select("access_token")
    .eq("id", p.id)
    .eq("document_id", doc.id)
    .maybeSingle();
  const token = (row as { access_token: string } | null)?.access_token;
  if (!token) return { ok: false, error: NOT_FOUND };
  redirect(`/sign/${token}`);
}

/* ------------------------------------------------------------ 삭제 */

export async function deleteDraftDocument(wid: string, docId: string): Promise<ActionResult> {
  const actor = await getActor(wid);
  if (!actor) return { ok: false, error: NO_PERMISSION };
  if (!isUuid(docId)) return { ok: false, error: NOT_FOUND };
  const [doc] = await loadDocs(actor, wid, [docId]);
  if (!doc) return { ok: false, error: NOT_FOUND };
  if (doc.owner_id !== actor.userId) return { ok: false, error: "내가 작성한 문서만 삭제할 수 있습니다." };
  if (doc.status !== "draft") return { ok: false, error: "작성 중인 문서만 삭제할 수 있습니다." };

  const { data: deleted, error } = await actor.supabase.from("documents").delete().eq("id", docId).eq("status", "draft").select("id");
  if (error || !deleted?.length) return { ok: false, error: "문서를 삭제하지 못했습니다." };

  // Remove the uploaded PDF of the deleted draft — its canonical path (never a stored one), with the
  // user's session (storage RLS), so a shared template file is never touched.
  const files = doc.file_path ? [paths.documentOriginal(wid, docId)] : [];
  if (files.length) {
    const { error: rmError } = await actor.supabase.storage.from(BUCKET).remove(files);
    if (rmError) console.error("[documents] storage cleanup failed:", rmError.message);
  }
  revalidateDocs(wid);
  return { ok: true };
}
