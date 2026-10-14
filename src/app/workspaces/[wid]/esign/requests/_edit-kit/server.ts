import "server-only";

import { revalidatePath } from "next/cache";

import { BUCKET, MAX_PDF_BYTES, paths } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import type { MemberRole, PageSize } from "@/lib/types";

/**
 * Server helpers shared by the 문서 편집기 / 서식 작성기 server actions
 * (membership checks, payload validation, draft-document creation).
 */

export type ActionResult<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

export interface MemberCtx {
  supabase: Supabase;
  wid: string;
  userId: string;
  email: string;
  name: string;
  role: MemberRole;
  isAdmin: boolean;
}

/** Signed-in user that belongs to workspace `wid` (RLS client bound to the user). */
export async function requireMember(wid: unknown): Promise<{ ok: true; ctx: MemberCtx } | { ok: false; error: string }> {
  if (!isUuid(wid)) return { ok: false, error: "잘못된 워크스페이스입니다." };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다." };
  const [{ data: member }, { data: profile }] = await Promise.all([
    supabase.from("workspace_members").select("role").eq("workspace_id", wid).eq("user_id", user.id).maybeSingle(),
    supabase.from("profiles").select("name, email").eq("id", user.id).maybeSingle(),
  ]);
  if (!member) return { ok: false, error: "이 워크스페이스에 접근할 권한이 없습니다." };
  const role = member.role as MemberRole;
  return {
    ok: true,
    ctx: {
      supabase,
      wid,
      userId: user.id,
      email: (profile?.email ?? user.email ?? "").toLowerCase(),
      name: profile?.name ?? user.email ?? "",
      role,
      isAdmin: role === "owner" || role === "admin",
    },
  };
}

/** Owner of the row or a workspace admin may change/delete it. */
export function canManage(ctx: Pick<MemberCtx, "userId" | "isAdmin">, ownerId: string) {
  return ctx.userId === ownerId || ctx.isAdmin;
}

/** Trim, collapse whitespace and cap the length of a user supplied title. */
export function cleanTitle(v: unknown, fallback: string, max = 100) {
  const s = typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim() : "";
  return (s || fallback).slice(0, max);
}

/** Size (bytes) of an object in the documents bucket, or null when it does not exist / is not readable. */
export async function storedObjectSize(supabase: Supabase, path: string): Promise<number | null> {
  const slash = path.lastIndexOf("/");
  const folder = path.slice(0, slash);
  const name = path.slice(slash + 1);
  const { data, error } = await supabase.storage.from(BUCKET).list(folder, { search: name, limit: 10 });
  if (error || !data) return null;
  const obj = data.find((o) => o.name === name);
  if (!obj) return null;
  const size = Number((obj.metadata as { size?: number } | null)?.size ?? 0);
  return Number.isFinite(size) ? size : 0;
}

export async function removeObject(supabase: Supabase, path: string) {
  await supabase.storage.from(BUCKET).remove([path]);
}

/** True when a row with `id` exists in `table` (RLS client: rows of the caller's workspaces). Errors count as "exists". */
async function rowExists(supabase: Supabase, table: "documents" | "editing_documents", id: string): Promise<boolean> {
  const { data, error } = await supabase.from(table).select("id").eq("id", id).maybeSingle();
  return !!data || !!error;
}

/**
 * Removes a PDF the browser uploaded for a document that was NOT created (validation / insert failed).
 * The ids come from the client, so an object that already belongs to an existing row is never touched.
 */
export async function removeOrphanUpload(
  supabase: Supabase,
  kind: "document" | "editing",
  wid: string,
  id: string,
): Promise<void> {
  if (!isUuid(wid) || !isUuid(id)) return;
  if (await rowExists(supabase, kind === "document" ? "documents" : "editing_documents", id)) return;
  await removeObject(supabase, kind === "document" ? paths.documentOriginal(wid, id) : paths.editing(wid, id));
}

/** Validates page count + page sizes (PDF points) sent by the browser after reading the generated PDF. */
export function validatePageInfo(pageCount: unknown, pageSizes: unknown): { pageCount: number; pageSizes: PageSize[] } | null {
  if (typeof pageCount !== "number" || !Number.isInteger(pageCount) || pageCount < 1 || pageCount > 1000) return null;
  if (!Array.isArray(pageSizes) || pageSizes.length !== pageCount) return null;
  const sizes: PageSize[] = [];
  for (const s of pageSizes) {
    const w = Number((s as PageSize)?.w);
    const h = Number((s as PageSize)?.h);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1 || w > 14400 || h > 14400) return null;
    sizes.push({ w: Math.round(w * 100) / 100, h: Math.round(h * 100) / 100 });
  }
  return { pageCount, pageSizes: sizes };
}

/**
 * Creates a `draft` sign-request document whose PDF the browser has already uploaded to
 * `paths.documentOriginal(wid, docId)`. Removes the uploaded object again when the insert fails.
 */
export async function insertDraftDocument(
  ctx: MemberCtx,
  input: { docId: unknown; title: string; pageCount: unknown; pageSizes: unknown },
): Promise<ActionResult<{ docId: string }>> {
  if (!isUuid(input.docId)) return { ok: false, error: "잘못된 문서 식별자입니다." };
  const docId = input.docId;
  const filePath = paths.documentOriginal(ctx.wid, docId);
  // the id comes from the browser: never adopt (or clean up) the file of an existing document
  if (await rowExists(ctx.supabase, "documents", docId)) return { ok: false, error: "잘못된 문서 식별자입니다." };
  const info = validatePageInfo(input.pageCount, input.pageSizes);
  if (!info) {
    await removeOrphanUpload(ctx.supabase, "document", ctx.wid, docId);
    return { ok: false, error: "PDF 페이지 정보를 확인할 수 없습니다." };
  }

  const size = await storedObjectSize(ctx.supabase, filePath);
  if (size == null) return { ok: false, error: "업로드된 PDF 파일을 찾을 수 없습니다. 다시 시도해 주세요." };
  if (size > MAX_PDF_BYTES) {
    await removeOrphanUpload(ctx.supabase, "document", ctx.wid, docId);
    return { ok: false, error: "PDF 파일은 최대 10MB까지 서명 요청할 수 있습니다." };
  }

  const now = new Date().toISOString();
  const { error } = await ctx.supabase.from("documents").insert({
    id: docId,
    workspace_id: ctx.wid,
    owner_id: ctx.userId,
    title: input.title,
    status: "draft",
    file_name: `${input.title}.pdf`,
    file_path: filePath,
    page_count: info.pageCount,
    page_sizes: info.pageSizes,
    last_activity_at: now,
  });
  if (error) {
    await removeOrphanUpload(ctx.supabase, "document", ctx.wid, docId);
    return { ok: false, error: "서명 요청 문서를 만들지 못했습니다." };
  }
  revalidatePath(`/workspaces/${ctx.wid}/esign/documents/documents`);
  revalidatePath(`/workspaces/${ctx.wid}/esign/home`);
  return { ok: true, docId };
}
