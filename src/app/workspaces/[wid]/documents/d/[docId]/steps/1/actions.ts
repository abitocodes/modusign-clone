"use server";

import { revalidatePath } from "next/cache";

import { BUCKET, paths } from "@/lib/storage";
import type { DeliveryMethod, FieldRow, Participant, TemplateField, TemplateRole } from "@/lib/types";

import { authorizeDocument, isUuid, wizardPaths } from "../../../_lib/access";
import {
  EMAIL_RE,
  LOCALES,
  MAX_PARTICIPANTS,
  type ActionResult,
  type ParticipantInput,
  type SaveParticipantsInput,
} from "../../../_lib/types";

const DELIVERIES: DeliveryMethod[] = ["email", "kakao", "in_person"];
const LOCALE_VALUES: string[] = LOCALES.map((l) => l.value);

interface CleanParticipant {
  id: string;
  name: string;
  email: string | null;
  delivery: DeliveryMethod | null;
  locale: string;
  auth_password: string | null;
  message: string | null;
  request_attachment: boolean;
}

function clean(p: ParticipantInput): CleanParticipant | string {
  if (!p || typeof p !== "object" || !isUuid(p.id)) return "잘못된 참여자 정보입니다.";
  const name = String(p.name ?? "").trim();
  if (name.length > 50) return "이름은 50자 이내로 입력해 주세요.";
  const delivery = p.delivery ?? null;
  if (delivery !== null && !DELIVERIES.includes(delivery)) return "잘못된 전송 수단입니다.";
  if (delivery === "kakao") return "카카오톡 전송은 준비 중입니다. 다른 전송 수단을 선택해 주세요.";
  const email = String(p.email ?? "").trim().toLowerCase();
  if (email.length > 254) return "이메일 주소가 너무 깁니다.";
  const locale = LOCALE_VALUES.includes(p.locale) ? p.locale : "ko";
  const pw = p.authPassword == null ? null : String(p.authPassword);
  if (pw !== null && (pw.length < 4 || pw.length > 20)) return "인증 비밀번호는 4~20자로 입력해 주세요.";
  const message = p.message == null ? null : String(p.message).trim().slice(0, 500) || null;
  return {
    id: p.id,
    name,
    email: delivery === "email" ? email || null : null,
    delivery,
    locale,
    auth_password: pw,
    message,
    request_attachment: !!p.requestAttachment,
  };
}

/** strict validation for 다음으로 */
function strictError(list: CleanParticipant[], who: string): string | null {
  if (list.length === 0) return `${who}를 1명 이상 추가해 주세요.`;
  const seen = new Set<string>();
  for (const p of list) {
    if (!p.name) return `${who}의 이름을 입력해 주세요.`;
    if (!p.delivery) return `${p.name}님의 전송 수단을 선택해 주세요.`;
    if (p.delivery === "email") {
      if (!p.email || !EMAIL_RE.test(p.email)) return `${p.name}님의 이메일 주소를 확인해 주세요.`;
      if (seen.has(p.email)) return `같은 이메일 주소(${p.email})를 가진 ${who}가 있습니다.`;
      seen.add(p.email);
    }
  }
  return null;
}

/**
 * Persists step 1 (request type, signing order, participants). Participant ids are stable:
 * existing rows are updated, new rows inserted, removed rows deleted together with their fields.
 * mode "draft" (임시 저장) accepts incomplete participants; "strict" (다음으로) validates fully.
 */
export async function saveParticipants(docId: string, input: SaveParticipantsInput, mode: "draft" | "strict"): Promise<ActionResult> {
  const auth = await authorizeDocument(docId);
  if (!auth.ok) return auth;
  const { supabase, doc } = auth;

  const requestType = input?.requestType === "view" ? "view" : input?.requestType === "sign" ? "sign" : null;
  const signingOrder = input?.signingOrder === "parallel" ? "parallel" : input?.signingOrder === "sequential" ? "sequential" : null;
  if (!requestType || !signingOrder) return { ok: false, error: "잘못된 요청입니다." };
  if (!Array.isArray(input.participants) || input.participants.length > MAX_PARTICIPANTS)
    return { ok: false, error: `참여자는 최대 ${MAX_PARTICIPANTS}명까지 지정할 수 있습니다.` };

  const list: CleanParticipant[] = [];
  for (const raw of input.participants) {
    const c = clean(raw);
    if (typeof c === "string") return { ok: false, error: c };
    list.push(c);
  }
  if (new Set(list.map((p) => p.id)).size !== list.length) return { ok: false, error: "잘못된 참여자 정보입니다." };

  const who = requestType === "view" ? "열람자" : "서명자";
  if (mode === "strict") {
    const err = strictError(list, who);
    if (err) return { ok: false, error: err };
  }

  const { data: existingRows, error: loadErr } = await supabase.from("participants").select("id").eq("document_id", doc.id);
  if (loadErr) return { ok: false, error: "참여자 정보를 불러오지 못했습니다." };
  const existing = new Set((existingRows ?? []).map((r: { id: string }) => r.id));
  const keep = new Set(list.map((p) => p.id));
  const removed = [...existing].filter((id) => !keep.has(id));

  if (removed.length) {
    const { error: fErr } = await supabase.from("fields").delete().eq("document_id", doc.id).in("participant_id", removed);
    const { error: pErr } = await supabase.from("participants").delete().eq("document_id", doc.id).in("id", removed);
    if (fErr || pErr) return { ok: false, error: "삭제한 참여자를 정리하지 못했습니다." };
  }

  const role = requestType === "view" ? "viewer" : "signer";
  const toInsert: Record<string, unknown>[] = [];
  const updates: PromiseLike<{ error: unknown }>[] = [];
  list.forEach((p, index) => {
    const row = {
      order_index: index,
      role,
      name: p.name,
      email: p.email,
      phone: null,
      delivery: p.delivery,
      locale: p.locale,
      auth_password: p.auth_password,
      message: p.message,
      request_attachment: p.request_attachment,
    };
    if (existing.has(p.id)) updates.push(supabase.from("participants").update(row).eq("id", p.id).eq("document_id", doc.id));
    else toInsert.push({ id: p.id, document_id: doc.id, status: "waiting", ...row });
  });

  const results = await Promise.all(updates);
  if (results.some((r) => r.error)) return { ok: false, error: "참여자 정보를 저장하지 못했습니다." };
  if (toInsert.length) {
    const { error } = await supabase.from("participants").insert(toInsert);
    if (error) return { ok: false, error: "참여자를 추가하지 못했습니다." };
  }

  const { error: docErr } = await supabase
    .from("documents")
    .update({ request_type: requestType, signing_order: signingOrder, last_activity_at: new Date().toISOString() })
    .eq("id", doc.id);
  if (docErr) return { ok: false, error: "문서 정보를 저장하지 못했습니다." };

  wizardPaths(doc.workspace_id, doc.id).forEach((p) => revalidatePath(p));
  return { ok: true };
}

/** 템플릿으로 저장: document PDF + participants (as roles) + fields → new template. */
export async function saveAsTemplate(docId: string): Promise<ActionResult<{ templateId: string }>> {
  const auth = await authorizeDocument(docId);
  if (!auth.ok) return auth;
  const { supabase, doc, userId } = auth;
  if (!doc.file_path) return { ok: false, error: "문서 파일이 없습니다." };

  const [{ data: parts }, { data: flds }] = await Promise.all([
    supabase.from("participants").select("id, name, order_index").eq("document_id", doc.id).order("order_index"),
    supabase.from("fields").select("*").eq("document_id", doc.id),
  ]);
  const who = doc.request_type === "view" ? "열람자" : "서명자";
  // generic role names: a reusable template must not carry this request's people
  const roles: TemplateRole[] = ((parts ?? []) as Pick<Participant, "id" | "name" | "order_index">[]).map((p, i) => ({
    key: p.id,
    name: `${who} ${i + 1}`,
    color_index: i,
  }));
  const roleKeys = new Set(roles.map((r) => r.key));
  const fields: TemplateField[] = ((flds ?? []) as FieldRow[])
    .filter((f) => f.participant_id && roleKeys.has(f.participant_id))
    .map((f) => ({
      role_key: f.participant_id!,
      type: f.type,
      page: f.page,
      x: f.x,
      y: f.y,
      width: f.width,
      height: f.height,
      required: f.required,
      options: f.options ?? {},
    }));

  const { data: tpl, error } = await supabase
    .from("templates")
    .insert({
      workspace_id: doc.workspace_id,
      owner_id: userId,
      title: doc.title,
      page_count: doc.page_count,
      page_sizes: doc.page_sizes,
      request_type: doc.request_type,
      signing_order: doc.signing_order,
      roles,
      fields,
      label_ids: doc.label_ids ?? [],
      last_modified_by: userId,
    })
    .select("id")
    .single();
  if (error || !tpl) return { ok: false, error: "템플릿을 만들지 못했습니다." };
  const templateId = (tpl as { id: string }).id;

  const target = paths.template(doc.workspace_id, templateId);
  const { error: copyErr } = await supabase.storage.from(BUCKET).copy(doc.file_path, target);
  if (copyErr) {
    await supabase.from("templates").delete().eq("id", templateId);
    return { ok: false, error: "템플릿 문서를 복사하지 못했습니다." };
  }
  await supabase.from("templates").update({ file_path: target }).eq("id", templateId);

  revalidatePath(`/workspaces/${doc.workspace_id}/esign/requests/templates`);
  return { ok: true, templateId };
}

/**
 * 나가기 → 저장 안 함: a draft that was never saved (no participants, no fields) is removed
 * together with its uploaded file. Anything saved before is kept.
 */
export async function discardUnsavedDraft(docId: string): Promise<ActionResult<{ deleted: boolean }>> {
  const auth = await authorizeDocument(docId);
  if (!auth.ok) return auth;
  const { supabase, doc, userId } = auth;
  if (doc.status !== "draft" || doc.owner_id !== userId || doc.template_id) return { ok: true, deleted: false };

  const [{ count: pc }, { count: fc }] = await Promise.all([
    supabase.from("participants").select("id", { count: "exact", head: true }).eq("document_id", doc.id),
    supabase.from("fields").select("id", { count: "exact", head: true }).eq("document_id", doc.id),
  ]);
  if ((pc ?? 0) > 0 || (fc ?? 0) > 0) return { ok: true, deleted: false };

  const files = [paths.documentOriginal(doc.workspace_id, doc.id), ...(doc.attachments ?? []).map((a) => a.path)];
  await supabase.storage.from(BUCKET).remove(files);
  const { error } = await supabase.from("documents").delete().eq("id", doc.id);
  if (error) return { ok: true, deleted: false };
  revalidatePath(`/workspaces/${doc.workspace_id}/esign/documents/documents`);
  return { ok: true, deleted: true };
}
