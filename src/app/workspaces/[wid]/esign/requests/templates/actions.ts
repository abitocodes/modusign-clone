"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import type { EditorField, EditorParticipant } from "@/components/editor/editor-model";
import { BUCKET, paths } from "@/lib/storage";
import { signedUrl } from "@/lib/storage-server";
import { createClient } from "@/lib/supabase/server";
import { isUuid, toEditorFields, type Result } from "@/lib/templates/model";
import { canManageTemplate, memberRole } from "@/lib/templates/server";
import type { MemberRole, PageSize, TemplateRow } from "@/lib/types";

const MAX_PINS = 30;
const MAX_BATCH = 100;

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

type TemplateMeta = Pick<TemplateRow, "id" | "workspace_id" | "owner_id" | "title" | "file_path" | "shared">;

/** Reads a template the caller can see (RLS: own, shared, or admin). */
async function loadVisible(supabase: Supabase, wid: string, tid: unknown): Promise<TemplateMeta | null> {
  if (!isUuid(tid)) return null;
  const { data } = await supabase
    .from("templates")
    .select("id, workspace_id, owner_id, title, file_path, shared")
    .eq("id", tid)
    .eq("workspace_id", wid)
    .maybeSingle();
  return (data as TemplateMeta | null) ?? null;
}

/** pages that list templates (the pickers of 대량전송 / 링크서명 and the wizard's template cards) */
function revalidateTemplates(wid: string) {
  revalidatePath(`/workspaces/${wid}/esign/requests/templates`);
  revalidatePath(`/workspaces/${wid}/esign/requests/bulk-requests`);
  revalidatePath(`/workspaces/${wid}/esign/requests/links`);
  revalidatePath(`/workspaces/${wid}/documents/d/upload`);
}

/** 자주 쓰는 템플릿 고정 / 고정 해제 (per user). */
export async function setTemplatePinned(wid: string, tid: string, pinned: boolean): Promise<Result> {
  const auth = await authorize(wid);
  if (!auth.ok) return auth;
  const t = await loadVisible(auth.supabase, wid, tid);
  if (!t) return { ok: false, error: "템플릿을 찾을 수 없습니다." };

  if (pinned) {
    const { count } = await auth.supabase.from("template_pins").select("template_id", { count: "exact", head: true }).eq("user_id", auth.userId);
    if ((count ?? 0) >= MAX_PINS) return { ok: false, error: `자주 쓰는 템플릿은 최대 ${MAX_PINS}개까지 지정할 수 있습니다.` };
    const { error } = await auth.supabase
      .from("template_pins")
      .upsert({ template_id: t.id, user_id: auth.userId }, { onConflict: "template_id,user_id", ignoreDuplicates: true });
    if (error) return { ok: false, error: "자주 쓰는 템플릿으로 지정하지 못했습니다." };
  } else {
    const { error } = await auth.supabase.from("template_pins").delete().eq("template_id", t.id).eq("user_id", auth.userId);
    if (error) return { ok: false, error: "고정을 해제하지 못했습니다." };
  }
  revalidatePath(`/workspaces/${wid}/esign/requests/templates`);
  return { ok: true };
}

/** 공유하기 / 공유 해제 — owner or workspace admin. */
export async function setTemplateShared(wid: string, tid: string, shared: boolean): Promise<Result> {
  const auth = await authorize(wid);
  if (!auth.ok) return auth;
  const t = await loadVisible(auth.supabase, wid, tid);
  if (!t) return { ok: false, error: "템플릿을 찾을 수 없습니다." };
  if (!canManageTemplate(t, auth.userId, auth.role)) return { ok: false, error: "템플릿을 등록한 멤버나 관리자만 공유 설정을 바꿀 수 있습니다." };
  const { error } = await auth.supabase.from("templates").update({ shared: !!shared }).eq("id", t.id);
  if (error) return { ok: false, error: "공유 설정을 저장하지 못했습니다." };
  revalidateTemplates(wid);
  return { ok: true };
}

/** 복제: copies the row (owned by the caller, not shared) and the PDF. */
export async function duplicateTemplate(wid: string, tid: string): Promise<Result<{ id: string }>> {
  const auth = await authorize(wid);
  if (!auth.ok) return auth;
  if (!isUuid(tid)) return { ok: false, error: "잘못된 요청입니다." };
  const { data } = await auth.supabase.from("templates").select("*").eq("id", tid).eq("workspace_id", wid).maybeSingle();
  const src = data as TemplateRow | null;
  if (!src) return { ok: false, error: "템플릿을 찾을 수 없습니다." };
  if (!src.file_path) return { ok: false, error: "템플릿 문서 파일이 없어 복제할 수 없습니다." };

  const id = randomUUID();
  const target = paths.template(wid, id);
  const { error: copyErr } = await auth.supabase.storage.from(BUCKET).copy(src.file_path, target);
  if (copyErr) return { ok: false, error: "템플릿 문서를 복사하지 못했습니다." };

  const suffix = " (복사본)";
  const title = src.title.length + suffix.length > 100 ? `${src.title.slice(0, 100 - suffix.length)}${suffix}` : `${src.title}${suffix}`;
  const now = new Date().toISOString();
  const { error } = await auth.supabase.from("templates").insert({
    id,
    workspace_id: wid,
    owner_id: auth.userId,
    title,
    file_path: target,
    page_count: src.page_count,
    page_sizes: src.page_sizes,
    request_type: src.request_type,
    signing_order: src.signing_order,
    roles: src.roles,
    fields: src.fields,
    label_ids: src.label_ids,
    shared: false,
    last_modified_by: auth.userId,
    created_at: now,
    updated_at: now,
  });
  if (error) {
    await auth.supabase.storage.from(BUCKET).remove([target]);
    return { ok: false, error: "템플릿을 복제하지 못했습니다." };
  }
  revalidateTemplates(wid);
  return { ok: true, id };
}

/** 삭제 (one or many) — only the templates the caller may manage; their PDFs are removed too. */
export async function deleteTemplates(wid: string, ids: string[]): Promise<Result<{ count: number; skipped: number }>> {
  const auth = await authorize(wid);
  if (!auth.ok) return auth;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_BATCH || !ids.every(isUuid)) {
    return { ok: false, error: "삭제할 템플릿을 선택해 주세요." };
  }
  const { data } = await auth.supabase.from("templates").select("id, owner_id, file_path").eq("workspace_id", wid).in("id", ids);
  const rows = (data ?? []) as Pick<TemplateRow, "id" | "owner_id" | "file_path">[];
  const allowed = rows.filter((t) => canManageTemplate(t, auth.userId, auth.role));
  if (allowed.length === 0) return { ok: false, error: "템플릿을 등록한 멤버나 관리자만 삭제할 수 있습니다." };

  const { error } = await auth.supabase
    .from("templates")
    .delete()
    .in(
      "id",
      allowed.map((t) => t.id),
    );
  if (error) return { ok: false, error: "템플릿을 삭제하지 못했습니다." };

  const files = allowed.map((t) => t.file_path).filter((p): p is string => !!p);
  if (files.length) await auth.supabase.storage.from(BUCKET).remove(files);

  revalidateTemplates(wid);
  return { ok: true, count: allowed.length, skipped: ids.length - allowed.length };
}

export interface TemplatePreview {
  title: string;
  pdfUrl: string;
  pageSizes: PageSize[];
  participants: EditorParticipant[];
  fields: EditorField[];
}

/** Data for the signer-view preview (FieldPreviewModal). */
export async function getTemplatePreview(wid: string, tid: string): Promise<Result<{ preview: TemplatePreview }>> {
  const auth = await authorize(wid);
  if (!auth.ok) return auth;
  if (!isUuid(tid)) return { ok: false, error: "잘못된 요청입니다." };
  const { data } = await auth.supabase
    .from("templates")
    .select("id, title, file_path, page_sizes, roles, fields")
    .eq("id", tid)
    .eq("workspace_id", wid)
    .maybeSingle();
  const t = data as Pick<TemplateRow, "id" | "title" | "file_path" | "page_sizes" | "roles" | "fields"> | null;
  if (!t) return { ok: false, error: "템플릿을 찾을 수 없습니다." };
  // the row was read with the member's RLS session → safe to sign its file
  const url = await signedUrl(t.file_path ? paths.template(wid, t.id) : null, 60 * 60);
  if (!url) return { ok: false, error: "템플릿 문서를 불러오지 못했습니다." };

  const roles = Array.isArray(t.roles) ? t.roles : [];
  const participants: EditorParticipant[] = roles.map((r, i) => ({ key: r.key, name: r.name || `서명자 ${i + 1}`, colorIndex: i }));
  let n = 0;
  const fields = toEditorFields(t.fields, new Set(roles.map((r) => r.key)), () => `preview-${n++}`);
  return {
    ok: true,
    preview: { title: t.title, pdfUrl: url, pageSizes: Array.isArray(t.page_sizes) ? t.page_sizes : [], participants, fields },
  };
}
