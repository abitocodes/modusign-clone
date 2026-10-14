"use server";

import { revalidatePath } from "next/cache";

import { MAX_PDF_BYTES, paths } from "@/lib/storage";

import {
  canManage,
  cleanTitle,
  insertDraftDocument,
  isUuid,
  removeObject,
  removeOrphanUpload,
  requireMember,
  storedObjectSize,
  type ActionResult,
} from "../_edit-kit/server";
import { parseAnnotations } from "./annotations";

const listPath = (wid: string) => `/workspaces/${wid}/esign/requests/editing-documents`;

function titleFromFileName(name: string) {
  return cleanTitle(name.replace(/\.pdf$/i, ""), "제목 없는 문서");
}

/** Registers a PDF the browser uploaded to `paths.editing(wid, id)` as a new 문서 편집기 document. */
export async function createEditingDocument(input: { wid: string; id: string; fileName: string }): Promise<ActionResult<{ id: string }>> {
  const auth = await requireMember(input?.wid);
  if (!auth.ok) return auth;
  const { ctx } = auth;
  if (!isUuid(input.id)) return { ok: false, error: "잘못된 요청입니다." };

  const fileName = cleanTitle(input.fileName, "document.pdf", 200);
  const filePath = paths.editing(ctx.wid, input.id);
  const size = await storedObjectSize(ctx.supabase, filePath);
  if (size == null) return { ok: false, error: "업로드된 파일을 찾을 수 없습니다. 다시 시도해 주세요." };
  if (size > MAX_PDF_BYTES) {
    await removeOrphanUpload(ctx.supabase, "editing", ctx.wid, input.id);
    return { ok: false, error: "PDF 파일은 최대 10MB까지 업로드할 수 있습니다." };
  }

  const { error } = await ctx.supabase.from("editing_documents").insert({
    id: input.id,
    workspace_id: ctx.wid,
    owner_id: ctx.userId,
    title: titleFromFileName(fileName),
    file_name: fileName,
    file_path: filePath,
    status: "editing",
  });
  if (error) {
    // never removes the file of an existing editing document (the id comes from the browser)
    await removeOrphanUpload(ctx.supabase, "editing", ctx.wid, input.id);
    return { ok: false, error: "문서를 등록하지 못했습니다." };
  }
  revalidatePath(listPath(ctx.wid));
  return { ok: true, id: input.id };
}

async function loadManageable(wid: unknown, id: unknown) {
  const auth = await requireMember(wid);
  if (!auth.ok) return auth;
  if (!isUuid(id)) return { ok: false as const, error: "잘못된 요청입니다." };
  const { data: row } = await auth.ctx.supabase
    .from("editing_documents")
    .select("id, owner_id, title, file_path, status")
    .eq("id", id)
    .eq("workspace_id", auth.ctx.wid)
    .maybeSingle();
  if (!row) return { ok: false as const, error: "문서를 찾을 수 없습니다." };
  return { ok: true as const, ctx: auth.ctx, row: row as { id: string; owner_id: string; title: string; file_path: string | null; status: string } };
}

export async function renameEditingDocument(input: { wid: string; id: string; title: string }): Promise<ActionResult> {
  const r = await loadManageable(input?.wid, input?.id);
  if (!r.ok) return r;
  if (!canManage(r.ctx, r.row.owner_id)) return { ok: false, error: "문서를 만든 멤버 또는 관리자만 이름을 바꿀 수 있습니다." };
  const title = cleanTitle(input.title, "");
  if (!title) return { ok: false, error: "문서 제목을 입력해 주세요." };
  const { error } = await r.ctx.supabase
    .from("editing_documents")
    .update({ title, last_activity_at: new Date().toISOString() })
    .eq("id", r.row.id);
  if (error) return { ok: false, error: "이름을 변경하지 못했습니다." };
  revalidatePath(listPath(r.ctx.wid));
  revalidatePath(`${listPath(r.ctx.wid)}/${r.row.id}`);
  return { ok: true };
}

export async function deleteEditingDocument(input: { wid: string; id: string }): Promise<ActionResult> {
  const r = await loadManageable(input?.wid, input?.id);
  if (!r.ok) return r;
  if (!canManage(r.ctx, r.row.owner_id)) return { ok: false, error: "문서를 만든 멤버 또는 관리자만 삭제할 수 있습니다." };
  const { error } = await r.ctx.supabase.from("editing_documents").delete().eq("id", r.row.id);
  if (error) return { ok: false, error: "문서를 삭제하지 못했습니다." };
  if (r.row.file_path) await removeObject(r.ctx.supabase, r.row.file_path);
  revalidatePath(listPath(r.ctx.wid));
  return { ok: true };
}

export async function saveEditingAnnotations(input: {
  wid: string;
  id: string;
  annotations: unknown;
  pageCount: number;
}): Promise<ActionResult<{ savedAt: string }>> {
  const r = await loadManageable(input?.wid, input?.id);
  if (!r.ok) return r;
  if (!canManage(r.ctx, r.row.owner_id)) return { ok: false, error: "문서를 만든 멤버 또는 관리자만 저장할 수 있습니다." };
  const pageCount = Number.isInteger(input.pageCount) && input.pageCount > 0 ? input.pageCount : 10000;
  const annotations = parseAnnotations(input.annotations, pageCount);
  if (!annotations) return { ok: false, error: "저장할 수 없는 편집 내용입니다. (최대 500개)" };
  const savedAt = new Date().toISOString();
  const { error } = await r.ctx.supabase
    .from("editing_documents")
    .update({ annotations, status: "editing", last_activity_at: savedAt })
    .eq("id", r.row.id);
  if (error) return { ok: false, error: "저장하지 못했습니다." };
  revalidatePath(listPath(r.ctx.wid));
  return { ok: true, savedAt };
}

/**
 * "서명 요청하기": the browser flattened the annotations into a new PDF and uploaded it to
 * `paths.documentOriginal(wid, docId)`; create the draft document and mark the edit as 편집 완료.
 */
export async function requestSignFromEditing(input: {
  wid: string;
  id: string;
  docId: string;
  pageCount: number;
  pageSizes: unknown;
}): Promise<ActionResult<{ docId: string }>> {
  const r = await loadManageable(input?.wid, input?.id);
  if (!r.ok) {
    if (isUuid(input?.docId) && isUuid(input?.wid)) {
      const auth = await requireMember(input.wid);
      if (auth.ok) await removeOrphanUpload(auth.ctx.supabase, "document", auth.ctx.wid, input.docId);
    }
    return r;
  }
  const created = await insertDraftDocument(r.ctx, {
    docId: input.docId,
    title: cleanTitle(r.row.title, "제목 없는 문서"),
    pageCount: input.pageCount,
    pageSizes: input.pageSizes,
  });
  if (!created.ok) return created;
  if (canManage(r.ctx, r.row.owner_id)) {
    await r.ctx.supabase
      .from("editing_documents")
      .update({ status: "done", last_activity_at: new Date().toISOString() })
      .eq("id", r.row.id);
  }
  revalidatePath(listPath(r.ctx.wid));
  return { ok: true, docId: created.docId };
}
