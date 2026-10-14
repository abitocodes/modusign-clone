"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { BUCKET, paths } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import { cleanTemplatePayload, isUuid, type Result, type TemplatePayload } from "@/lib/templates/model";
import { canManageTemplate, memberRole } from "@/lib/templates/server";
import type { Label, MemberRole, PageSize, TemplateRow } from "@/lib/types";
import { PARTICIPANT_COLORS } from "@/lib/utils";

type Supabase = Awaited<ReturnType<typeof createClient>>;
type Auth = { ok: true; supabase: Supabase; userId: string; role: MemberRole } | { ok: false; error: string };

async function authorize(wid: unknown): Promise<Auth> {
  if (!isUuid(wid)) return { ok: false, error: "잘못된 요청입니다." };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다. 다시 로그인해 주세요." };
  const role = await memberRole(supabase, wid, user.id);
  if (!role) return { ok: false, error: "이 워크스페이스에 접근할 권한이 없습니다." };
  return { ok: true, supabase, userId: user.id, role };
}

/** Keeps only label ids that exist in the workspace. */
async function existingLabels(supabase: Supabase, wid: string, ids: string[]) {
  if (ids.length === 0) return [];
  const { data } = await supabase.from("labels").select("id").eq("workspace_id", wid).in("id", ids);
  const ok = new Set(((data ?? []) as { id: string }[]).map((l) => l.id));
  return ids.filter((id) => ok.has(id));
}

/** Does the template PDF exist in storage? (uploaded by the browser with the member's session) */
async function fileExists(supabase: Supabase, wid: string, tid: string) {
  const { data } = await supabase.storage.from(BUCKET).list(`${wid}/templates`, { search: `${tid}.pdf`, limit: 10 });
  return !!data?.some((o) => o.name === `${tid}.pdf`);
}

function revalidateTemplates(wid: string) {
  revalidatePath(`/workspaces/${wid}/esign/requests/templates`);
  revalidatePath(`/workspaces/${wid}/esign/requests/bulk-requests`);
  revalidatePath(`/workspaces/${wid}/esign/requests/links`);
  revalidatePath(`/workspaces/${wid}/documents/d/upload`);
}

/**
 * 템플릿 등록, step 1: validates the editor payload and creates the row (file_path still null).
 * The browser then uploads the PDF to `path` and calls attachTemplateFile().
 */
export async function createTemplate(wid: string, payload: TemplatePayload): Promise<Result<{ id: string; path: string }>> {
  const auth = await authorize(wid);
  if (!auth.ok) return auth;
  const clean = cleanTemplatePayload(payload);
  if (!clean.ok) return clean;
  const v = clean.value;

  const id = randomUUID();
  const now = new Date().toISOString();
  const { error } = await auth.supabase.from("templates").insert({
    id,
    workspace_id: wid,
    owner_id: auth.userId,
    title: v.title,
    file_path: null,
    page_count: v.page_count,
    page_sizes: v.page_sizes,
    request_type: v.request_type,
    signing_order: v.signing_order,
    roles: v.roles,
    fields: v.fields,
    label_ids: await existingLabels(auth.supabase, wid, v.label_ids),
    shared: v.shared,
    last_modified_by: auth.userId,
    created_at: now,
    updated_at: now,
  });
  if (error) return { ok: false, error: "템플릿을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  return { ok: true, id, path: paths.template(wid, id) };
}

/** 템플릿 등록, step 2: links the uploaded PDF (paths.template) to the new row. */
export async function attachTemplateFile(wid: string, tid: string): Promise<Result> {
  const auth = await authorize(wid);
  if (!auth.ok) return auth;
  if (!isUuid(tid)) return { ok: false, error: "잘못된 요청입니다." };
  const { data } = await auth.supabase.from("templates").select("id, owner_id, file_path").eq("id", tid).eq("workspace_id", wid).maybeSingle();
  const t = data as Pick<TemplateRow, "id" | "owner_id" | "file_path"> | null;
  if (!t || t.owner_id !== auth.userId) return { ok: false, error: "템플릿을 찾을 수 없습니다." };
  if (!(await fileExists(auth.supabase, wid, tid))) return { ok: false, error: "업로드한 문서를 찾을 수 없습니다. 다시 시도해 주세요." };

  const { error } = await auth.supabase
    .from("templates")
    .update({ file_path: paths.template(wid, tid), updated_at: new Date().toISOString() })
    .eq("id", tid);
  if (error) return { ok: false, error: "템플릿을 저장하지 못했습니다." };
  revalidateTemplates(wid);
  return { ok: true };
}

/** Removes a template whose upload never completed (row without file + any uploaded object). */
export async function discardTemplate(wid: string, tid: string): Promise<Result> {
  const auth = await authorize(wid);
  if (!auth.ok) return auth;
  if (!isUuid(tid)) return { ok: false, error: "잘못된 요청입니다." };
  const { data } = await auth.supabase.from("templates").select("id, owner_id, file_path").eq("id", tid).eq("workspace_id", wid).maybeSingle();
  const t = data as Pick<TemplateRow, "id" | "owner_id" | "file_path"> | null;
  if (!t || t.owner_id !== auth.userId || t.file_path) return { ok: false, error: "삭제할 수 없는 템플릿입니다." };
  await auth.supabase.storage.from(BUCKET).remove([paths.template(wid, tid)]);
  await auth.supabase.from("templates").delete().eq("id", tid);
  return { ok: true };
}

/**
 * 템플릿 수정 (owner or admin). When the document was replaced the browser has already uploaded
 * the new PDF to paths.template(wid, tid); otherwise the stored page sizes are kept.
 */
export async function updateTemplate(
  wid: string,
  tid: string,
  payload: TemplatePayload,
  opts: { fileReplaced: boolean },
): Promise<Result> {
  const auth = await authorize(wid);
  if (!auth.ok) return auth;
  if (!isUuid(tid)) return { ok: false, error: "잘못된 요청입니다." };
  const { data } = await auth.supabase
    .from("templates")
    .select("id, owner_id, file_path, page_sizes, shared")
    .eq("id", tid)
    .eq("workspace_id", wid)
    .maybeSingle();
  const t = data as Pick<TemplateRow, "id" | "owner_id" | "file_path" | "page_sizes" | "shared"> | null;
  if (!t) return { ok: false, error: "템플릿을 찾을 수 없습니다." };
  if (!canManageTemplate(t, auth.userId, auth.role)) return { ok: false, error: "템플릿을 등록한 멤버나 관리자만 수정할 수 있습니다." };

  const replaced = opts?.fileReplaced === true;
  if (replaced && !(await fileExists(auth.supabase, wid, tid))) {
    return { ok: false, error: "업로드한 문서를 찾을 수 없습니다. 다시 시도해 주세요." };
  }
  if (!replaced && !t.file_path) return { ok: false, error: "템플릿 문서 파일이 없습니다. 문서를 다시 업로드해 주세요." };

  const stored = (Array.isArray(t.page_sizes) ? t.page_sizes : []) as PageSize[];
  const clean = cleanTemplatePayload(payload, replaced || stored.length === 0 ? undefined : stored);
  if (!clean.ok) return clean;
  const v = clean.value;

  const update: Record<string, unknown> = {
    title: v.title,
    request_type: v.request_type,
    signing_order: v.signing_order,
    roles: v.roles,
    fields: v.fields,
    label_ids: await existingLabels(auth.supabase, wid, v.label_ids),
    shared: v.shared,
    page_count: v.page_count,
    page_sizes: v.page_sizes,
    last_modified_by: auth.userId,
    updated_at: new Date().toISOString(),
  };
  if (replaced) update.file_path = paths.template(wid, tid);

  const { error } = await auth.supabase.from("templates").update(update).eq("id", tid);
  if (error) return { ok: false, error: "템플릿을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  revalidateTemplates(wid);
  return { ok: true };
}

/** 라벨 만들기 (template editor / 링크서명). Returns the existing label when the name is taken. */
export async function createTemplateLabel(wid: string, name: string, color?: string): Promise<Result<{ label: Label }>> {
  const auth = await authorize(wid);
  if (!auth.ok) return auth;
  const trimmed = typeof name === "string" ? name.trim().replace(/\s+/g, " ") : "";
  if (!trimmed) return { ok: false, error: "라벨 이름을 입력하세요." };
  if (trimmed.length > 20) return { ok: false, error: "라벨 이름은 20자 이내로 입력하세요." };

  const { data: existing } = await auth.supabase.from("labels").select("*").eq("workspace_id", wid);
  const list = (existing ?? []) as Label[];
  const dup = list.find((l) => l.name.toLowerCase() === trimmed.toLowerCase());
  if (dup) return { ok: true, label: dup };
  if (list.length >= 200) return { ok: false, error: "라벨은 최대 200개까지 만들 수 있습니다." };

  const safeColor = typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color) ? color : PARTICIPANT_COLORS[list.length % PARTICIPANT_COLORS.length];
  const { data, error } = await auth.supabase.from("labels").insert({ workspace_id: wid, name: trimmed, color: safeColor }).select("*").single();
  if (error || !data) return { ok: false, error: "라벨을 만들지 못했습니다." };
  revalidatePath(`/workspaces/${wid}/esign/requests/templates`);
  revalidatePath(`/workspaces/${wid}/esign/requests/links`);
  return { ok: true, label: data as Label };
}
