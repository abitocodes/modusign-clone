"use server";

import { revalidatePath } from "next/cache";

import { cleanPersonName } from "@/lib/email/address";
import { sendDocument, validateDocumentForSend } from "@/lib/server/send";
import { BUCKET } from "@/lib/storage";
import type { DocumentAttachment, DocumentCc, Label } from "@/lib/types";

import { authorizeDocument, authorizeWorkspace, isUuid, wizardPaths, type DocAuth } from "../../../_lib/access";
import {
  isValidEmail,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  MAX_CC,
  type ActionResult,
  type RequestSettingsInput,
} from "../../../_lib/types";

type Authorised = Extract<DocAuth, { ok: true }>;

function revalidateWizard(wid: string, docId: string) {
  wizardPaths(wid, docId).forEach((p) => revalidatePath(p));
  revalidatePath(`/workspaces/${wid}/esign/home`);
}

/** Validates + normalises a settings patch. Returns the DB patch or an error message. */
async function cleanSettings(auth: Authorised, input: RequestSettingsInput): Promise<Record<string, unknown> | string> {
  const patch: Record<string, unknown> = {};
  if (input.title !== undefined) {
    const title = String(input.title).trim();
    if (!title) return "문서 제목을 입력해 주세요.";
    if (title.length > 100) return "문서 제목은 100자 이내로 입력해 주세요.";
    patch.title = title;
  }
  if (input.expiresDays !== undefined) {
    const d = Number(input.expiresDays);
    if (!Number.isInteger(d) || d < 1 || d > 365) return "서명 유효 기한은 1일에서 365일 사이로 입력해 주세요.";
    patch.expires_days = d;
  }
  if (input.lockPassword !== undefined) {
    if (input.lockPassword === null) patch.lock_password = null;
    else {
      const pw = String(input.lockPassword);
      if (pw.length < 4 || pw.length > 20) return "문서 잠금 비밀번호는 4~20자로 입력해 주세요.";
      patch.lock_password = pw;
    }
  }
  if (input.labelIds !== undefined) {
    if (!Array.isArray(input.labelIds) || input.labelIds.length > 20 || !input.labelIds.every(isUuid)) return "잘못된 라벨입니다.";
    const ids = [...new Set(input.labelIds)];
    if (ids.length) {
      const { data } = await auth.supabase.from("labels").select("id").eq("workspace_id", auth.doc.workspace_id).in("id", ids);
      const found = new Set((data ?? []).map((l: { id: string }) => l.id));
      patch.label_ids = ids.filter((id) => found.has(id));
    } else patch.label_ids = [];
  }
  if (input.cc !== undefined) {
    if (!Array.isArray(input.cc) || input.cc.length > MAX_CC) return `외부 참조자는 최대 ${MAX_CC}명까지 지정할 수 있습니다.`;
    const seen = new Set<string>();
    const cc: DocumentCc[] = [];
    for (const c of input.cc) {
      const rawName = String(c?.name ?? "");
      if (rawName.length > 200) return "참조자 이름을 확인해 주세요.";
      const name = cleanPersonName(rawName, 200);
      const email = String(c?.email ?? "").trim().toLowerCase();
      if (!name || name.length > 50) return "참조자 이름을 확인해 주세요.";
      if (!isValidEmail(email)) return `참조자 이메일 주소(${email.slice(0, 254) || "빈 값"})를 확인해 주세요.`;
      if (seen.has(email)) continue;
      seen.add(email);
      cc.push({ name, email });
    }
    patch.cc = cc;
  }
  return patch;
}

async function applySettings(auth: Authorised, input: RequestSettingsInput): Promise<string | null> {
  const patch = await cleanSettings(auth, input ?? {});
  if (typeof patch === "string") return patch;
  const { error } = await auth.supabase
    .from("documents")
    .update({ ...patch, last_activity_at: new Date().toISOString() })
    .eq("id", auth.doc.id);
  return error ? "요청 정보를 저장하지 못했습니다." : null;
}

/** 임시 저장 / 이전 / modal saves */
export async function saveRequestSettings(docId: string, input: RequestSettingsInput): Promise<ActionResult> {
  const auth = await authorizeDocument(docId);
  if (!auth.ok) return auth;
  const err = await applySettings(auth, input);
  if (err) return { ok: false, error: err };
  revalidateWizard(auth.doc.workspace_id, auth.doc.id);
  return { ok: true };
}

/** Saves the settings and checks that the document can be sent (before the confirm modals). */
export async function prepareSend(docId: string, input: RequestSettingsInput): Promise<ActionResult> {
  const auth = await authorizeDocument(docId);
  if (!auth.ok) return auth;
  const err = await applySettings(auth, input);
  if (err) return { ok: false, error: err };
  const invalid = await validateDocumentForSend(docId);
  revalidateWizard(auth.doc.workspace_id, auth.doc.id);
  return invalid ? { ok: false, error: invalid } : { ok: true };
}

/** 즉시 전송 */
export async function sendNow(docId: string, input: RequestSettingsInput): Promise<ActionResult> {
  const auth = await authorizeDocument(docId);
  if (!auth.ok) return auth;
  const err = await applySettings(auth, input);
  if (err) return { ok: false, error: err };

  const { data: me } = await auth.supabase.from("profiles").select("name, email").eq("id", auth.userId).maybeSingle();
  const actor = me ? { name: (me as { name: string }).name, email: (me as { email: string }).email } : undefined;
  const res = await sendDocument(docId, { actor });
  revalidateWizard(auth.doc.workspace_id, auth.doc.id);
  revalidatePath(`/workspaces/${auth.doc.workspace_id}/documents/${auth.doc.id}`);
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}

/** 예약 전송 → status scheduled + scheduled_at (dispatched by the 문서함 page once due). */
export async function scheduleSend(docId: string, input: RequestSettingsInput, scheduledAt: string): Promise<ActionResult<{ scheduledAt: string }>> {
  const auth = await authorizeDocument(docId);
  if (!auth.ok) return auth;
  const when = new Date(String(scheduledAt));
  const now = Date.now();
  if (Number.isNaN(when.getTime())) return { ok: false, error: "예약 일시를 확인해 주세요." };
  if (when.getTime() < now + 60_000) return { ok: false, error: "예약 일시는 현재 시각 이후로 지정해 주세요." };
  if (when.getTime() > now + 365 * 24 * 60 * 60 * 1000) return { ok: false, error: "예약 전송은 1년 이내로만 지정할 수 있습니다." };

  const err = await applySettings(auth, input);
  if (err) return { ok: false, error: err };
  const invalid = await validateDocumentForSend(docId);
  if (invalid) return { ok: false, error: invalid };

  const iso = when.toISOString();
  const { data, error } = await auth.supabase
    .from("documents")
    .update({ status: "scheduled", scheduled_at: iso, last_activity_at: new Date().toISOString() })
    .eq("id", docId)
    .in("status", ["draft", "on_modifying"])
    .select("id");
  if (error || !data?.length) return { ok: false, error: "예약 전송을 설정하지 못했습니다." };
  revalidateWizard(auth.doc.workspace_id, auth.doc.id);
  return { ok: true, scheduledAt: iso };
}

/* ------------------------------------------------------------ attachments */

function attachmentPrefix(wid: string, docId: string) {
  return `${wid}/documents/${docId}/attachments/`;
}

/** Registers a file the browser uploaded to {wid}/documents/{docId}/attachments/. */
export async function addAttachment(
  docId: string,
  file: { name: string; path: string; size: number; type: string },
): Promise<ActionResult<{ attachments: DocumentAttachment[] }>> {
  const auth = await authorizeDocument(docId);
  if (!auth.ok) return auth;
  const { doc, supabase } = auth;
  const prefix = attachmentPrefix(doc.workspace_id, doc.id);
  const path = String(file?.path ?? "");
  const objectName = path.slice(prefix.length);
  if (!path.startsWith(prefix) || !/^[0-9a-f-]{36}\.[a-z0-9]{1,10}$/i.test(objectName)) return { ok: false, error: "잘못된 첨부파일입니다." };
  const size = Number(file.size);
  if (!Number.isFinite(size) || size <= 0 || size > MAX_ATTACHMENT_BYTES) return { ok: false, error: "첨부파일은 최대 10MB까지 올릴 수 있습니다." };

  const current = (doc.attachments ?? []) as DocumentAttachment[];
  if (current.length >= MAX_ATTACHMENTS) {
    await supabase.storage.from(BUCKET).remove([path]);
    return { ok: false, error: `첨부파일은 최대 ${MAX_ATTACHMENTS}개까지 올릴 수 있습니다.` };
  }
  const { data: objects } = await supabase.storage.from(BUCKET).list(prefix.slice(0, -1), { search: objectName });
  const object = objects?.find((o) => o.name === objectName);
  if (!object) return { ok: false, error: "업로드한 파일을 찾을 수 없습니다." };
  // the bucket limit is sized for generated PDFs: enforce the attachment limit from the stored object
  const stored = Number((object.metadata as { size?: number } | null)?.size ?? 0);
  if (!Number.isFinite(stored) || stored > MAX_ATTACHMENT_BYTES) {
    await supabase.storage.from(BUCKET).remove([path]);
    return { ok: false, error: "첨부파일은 최대 10MB까지 올릴 수 있습니다." };
  }

  const item: DocumentAttachment = {
    name: String(file.name ?? "첨부파일").trim().slice(0, 200) || "첨부파일",
    path,
    size,
    type: String(file.type ?? "").slice(0, 120) || "application/octet-stream",
    uploaded_at: new Date().toISOString(),
  };
  const attachments = [...current.filter((a) => a.path !== path), item];
  const { error } = await supabase.from("documents").update({ attachments, last_activity_at: item.uploaded_at }).eq("id", doc.id);
  if (error) return { ok: false, error: "첨부파일을 저장하지 못했습니다." };
  revalidateWizard(doc.workspace_id, doc.id);
  return { ok: true, attachments };
}

export async function removeAttachment(docId: string, path: string): Promise<ActionResult<{ attachments: DocumentAttachment[] }>> {
  const auth = await authorizeDocument(docId);
  if (!auth.ok) return auth;
  const { doc, supabase } = auth;
  const current = (doc.attachments ?? []) as DocumentAttachment[];
  const target = current.find((a) => a.path === path);
  if (!target) return { ok: true, attachments: current };
  if (path.startsWith(attachmentPrefix(doc.workspace_id, doc.id))) await supabase.storage.from(BUCKET).remove([path]);
  const attachments = current.filter((a) => a.path !== path);
  const { error } = await supabase.from("documents").update({ attachments }).eq("id", doc.id);
  if (error) return { ok: false, error: "첨부파일을 삭제하지 못했습니다." };
  revalidateWizard(doc.workspace_id, doc.id);
  return { ok: true, attachments };
}

/* ------------------------------------------------------------------ labels */

export async function createLabel(wid: string, name: string, color: string): Promise<ActionResult<{ label: Label }>> {
  const auth = await authorizeWorkspace(wid);
  if (!auth.ok) return auth;
  const n = String(name ?? "").trim();
  if (!n) return { ok: false, error: "라벨 이름을 입력해 주세요." };
  if (n.length > 20) return { ok: false, error: "라벨 이름은 20자 이내로 입력해 주세요." };
  const c = /^#[0-9a-f]{6}$/i.test(String(color)) ? String(color).toLowerCase() : "#5991f4";

  const { data: existing } = await auth.supabase.from("labels").select("*").eq("workspace_id", wid).eq("name", n).maybeSingle();
  if (existing) return { ok: true, label: existing as Label };
  const { data, error } = await auth.supabase.from("labels").insert({ workspace_id: wid, name: n, color: c }).select("*").single();
  if (error || !data) return { ok: false, error: "라벨을 만들지 못했습니다." };
  revalidatePath(`/workspaces/${wid}/esign/documents/documents`);
  return { ok: true, label: data as Label };
}
