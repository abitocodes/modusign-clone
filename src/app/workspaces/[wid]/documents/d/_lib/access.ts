import "server-only";

import { notFound, redirect } from "next/navigation";

import { getWorkspaceContext } from "@/lib/data/session";
import { createClient } from "@/lib/supabase/server";
import type { DocStatus, DocumentRow, MemberRole } from "@/lib/types";

/** Statuses the wizard (and the step-2 field editor) may edit. */
export const EDITABLE_STATUSES: DocStatus[] = ["draft", "on_modifying"];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

type ServerClient = Awaited<ReturnType<typeof createClient>>;

function canEdit(doc: Pick<DocumentRow, "owner_id">, userId: string, role: MemberRole) {
  return doc.owner_id === userId || role === "owner" || role === "admin";
}

/**
 * Wizard pages: loads a document the current user may edit. 404 when it does not exist in this
 * workspace; already-sent documents go to the read-only viewer.
 */
export async function loadEditableDocument(wid: string, docId: string) {
  if (!isUuid(docId)) notFound();
  const ctx = await getWorkspaceContext(wid);
  const supabase = await createClient();
  const { data } = await supabase.from("documents").select("*").eq("id", docId).eq("workspace_id", wid).maybeSingle();
  if (!data) notFound();
  const doc = data as DocumentRow;
  if (!canEdit(doc, ctx.profile.id, ctx.role)) notFound();
  if (!EDITABLE_STATUSES.includes(doc.status)) redirect(`/workspaces/${wid}/documents/${docId}`);
  return { ctx, supabase, doc };
}

export type DocAuth =
  | { ok: true; supabase: ServerClient; userId: string; role: MemberRole; doc: DocumentRow }
  | { ok: false; error: string };

/** Server actions: authorises the caller for an editable document (member + owner/admin). */
export async function authorizeDocument(docId: unknown, opts: { allowSent?: boolean } = {}): Promise<DocAuth> {
  if (!isUuid(docId)) return { ok: false, error: "잘못된 요청입니다." };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다." };
  const { data } = await supabase.from("documents").select("*").eq("id", docId).maybeSingle();
  if (!data) return { ok: false, error: "문서를 찾을 수 없습니다." };
  const doc = data as DocumentRow;
  const { data: member } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", doc.workspace_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member) return { ok: false, error: "이 문서에 접근할 권한이 없습니다." };
  const role = (member as { role: MemberRole }).role;
  if (!canEdit(doc, user.id, role)) return { ok: false, error: "이 문서를 수정할 권한이 없습니다." };
  if (!opts.allowSent && !EDITABLE_STATUSES.includes(doc.status))
    return { ok: false, error: "이미 전송된 문서는 수정할 수 없습니다." };
  return { ok: true, supabase, userId: user.id, role, doc };
}

/** Server actions: authorises the caller as a member of the workspace. */
export async function authorizeWorkspace(wid: unknown) {
  if (!isUuid(wid)) return { ok: false as const, error: "잘못된 요청입니다." };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "로그인이 필요합니다." };
  const { data: member } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", wid)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member) return { ok: false as const, error: "이 워크스페이스에 접근할 권한이 없습니다." };
  return { ok: true as const, supabase, userId: user.id, role: (member as { role: MemberRole }).role };
}

/** Paths to revalidate after a wizard mutation. */
export function wizardPaths(wid: string, docId: string) {
  return [
    `/workspaces/${wid}/documents/d/${docId}/steps/1`,
    `/workspaces/${wid}/documents/d/${docId}/steps/2`,
    `/workspaces/${wid}/documents/d/${docId}/steps/3`,
    `/workspaces/${wid}/esign/documents/documents`,
  ];
}
