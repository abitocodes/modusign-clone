"use server";

import { revalidatePath } from "next/cache";

import {
  canManage,
  cleanTitle,
  insertDraftDocument,
  isUuid,
  removeOrphanUpload,
  requireMember,
  type ActionResult,
} from "../_edit-kit/server";
import { MAX_DRAFT_HTML, sanitizeDraftHtml } from "./sanitize";

const DEFAULT_TITLE = "제목 없는 서식";
const listPath = (wid: string) => `/workspaces/${wid}/esign/requests/drafts`;

async function loadDraft(wid: unknown, id: unknown) {
  const auth = await requireMember(wid);
  if (!auth.ok) return auth;
  if (!isUuid(id)) return { ok: false as const, error: "잘못된 요청입니다." };
  const { data: row } = await auth.ctx.supabase
    .from("drafts")
    .select("id, owner_id, title, content")
    .eq("id", id)
    .eq("workspace_id", auth.ctx.wid)
    .maybeSingle();
  if (!row) return { ok: false as const, error: "서식을 찾을 수 없습니다." };
  return { ok: true as const, ctx: auth.ctx, row: row as { id: string; owner_id: string; title: string; content: string } };
}

export async function createDraft(input: { wid: string }): Promise<ActionResult<{ id: string }>> {
  const auth = await requireMember(input?.wid);
  if (!auth.ok) return auth;
  const { ctx } = auth;
  const { data, error } = await ctx.supabase
    .from("drafts")
    .insert({ workspace_id: ctx.wid, owner_id: ctx.userId, title: DEFAULT_TITLE, content: "" })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "서식을 만들지 못했습니다." };
  revalidatePath(listPath(ctx.wid));
  return { ok: true, id: data.id as string };
}

/**
 * Saves title + body. The HTML is sanitised on the server (whitelist) before it is stored.
 * Autosaves pass `revalidate: false` so the open editor is not re-rendered every few seconds
 * (the list page is dynamic and reads fresh data on the next visit anyway).
 */
export async function saveDraft(input: {
  wid: string;
  id: string;
  title: string;
  content: string;
  revalidate?: boolean;
}): Promise<ActionResult<{ updatedAt: string; title: string }>> {
  const r = await loadDraft(input?.wid, input?.id);
  if (!r.ok) return r;
  if (!canManage(r.ctx, r.row.owner_id)) return { ok: false, error: "서식을 만든 멤버 또는 관리자만 저장할 수 있습니다." };
  if (typeof input.content !== "string" || input.content.length > MAX_DRAFT_HTML * 2) {
    return { ok: false, error: "서식 내용이 너무 깁니다." };
  }
  const content = sanitizeDraftHtml(input.content);
  if (content.length > MAX_DRAFT_HTML) return { ok: false, error: "서식 내용이 너무 깁니다." };
  const title = cleanTitle(input.title, DEFAULT_TITLE);
  const updatedAt = new Date().toISOString();
  const { error } = await r.ctx.supabase.from("drafts").update({ title, content, updated_at: updatedAt }).eq("id", r.row.id);
  if (error) return { ok: false, error: "저장하지 못했습니다." };
  if (input.revalidate !== false) revalidatePath(listPath(r.ctx.wid));
  return { ok: true, updatedAt, title };
}

export async function renameDraft(input: { wid: string; id: string; title: string }): Promise<ActionResult> {
  const r = await loadDraft(input?.wid, input?.id);
  if (!r.ok) return r;
  if (!canManage(r.ctx, r.row.owner_id)) return { ok: false, error: "서식을 만든 멤버 또는 관리자만 이름을 바꿀 수 있습니다." };
  const title = cleanTitle(input.title, "");
  if (!title) return { ok: false, error: "서식 제목을 입력해 주세요." };
  const { error } = await r.ctx.supabase.from("drafts").update({ title, updated_at: new Date().toISOString() }).eq("id", r.row.id);
  if (error) return { ok: false, error: "이름을 변경하지 못했습니다." };
  revalidatePath(listPath(r.ctx.wid));
  return { ok: true };
}

export async function duplicateDraft(input: { wid: string; id: string }): Promise<ActionResult<{ id: string }>> {
  const r = await loadDraft(input?.wid, input?.id);
  if (!r.ok) return r;
  const { data, error } = await r.ctx.supabase
    .from("drafts")
    .insert({
      workspace_id: r.ctx.wid,
      owner_id: r.ctx.userId,
      title: cleanTitle(`${r.row.title} 사본`, DEFAULT_TITLE),
      content: sanitizeDraftHtml(r.row.content ?? ""),
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "서식을 복제하지 못했습니다." };
  revalidatePath(listPath(r.ctx.wid));
  return { ok: true, id: data.id as string };
}

export async function deleteDrafts(input: { wid: string; ids: string[] }): Promise<ActionResult<{ deleted: number; skipped: number }>> {
  const auth = await requireMember(input?.wid);
  if (!auth.ok) return auth;
  const { ctx } = auth;
  const ids = Array.isArray(input.ids) ? [...new Set(input.ids.filter(isUuid))].slice(0, 500) : [];
  if (!ids.length) return { ok: false, error: "삭제할 서식을 선택해 주세요." };
  const { data: rows } = await ctx.supabase.from("drafts").select("id, owner_id").eq("workspace_id", ctx.wid).in("id", ids);
  const allowed = (rows ?? []).filter((row) => canManage(ctx, row.owner_id as string)).map((row) => row.id as string);
  if (!allowed.length) return { ok: false, error: "서식을 만든 멤버 또는 관리자만 삭제할 수 있습니다." };
  const { error } = await ctx.supabase.from("drafts").delete().in("id", allowed);
  if (error) return { ok: false, error: "서식을 삭제하지 못했습니다." };
  revalidatePath(listPath(ctx.wid));
  return { ok: true, deleted: allowed.length, skipped: ids.length - allowed.length };
}

/**
 * "PDF로 서명 요청": the browser rendered the draft to an A4 PDF and uploaded it to
 * `paths.documentOriginal(wid, docId)`; create the draft sign-request document.
 */
export async function requestSignFromDraft(input: {
  wid: string;
  id: string;
  docId: string;
  pageCount: number;
  pageSizes: unknown;
}): Promise<ActionResult<{ docId: string }>> {
  const r = await loadDraft(input?.wid, input?.id);
  if (!r.ok) {
    if (isUuid(input?.docId) && isUuid(input?.wid)) {
      const auth = await requireMember(input.wid);
      if (auth.ok) await removeOrphanUpload(auth.ctx.supabase, "document", auth.ctx.wid, input.docId);
    }
    return r;
  }
  const created = await insertDraftDocument(r.ctx, {
    docId: input.docId,
    title: cleanTitle(r.row.title, DEFAULT_TITLE),
    pageCount: input.pageCount,
    pageSizes: input.pageSizes,
  });
  if (!created.ok) return created;
  revalidatePath(listPath(r.ctx.wid));
  return { ok: true, docId: created.docId };
}
