import { NextResponse, type NextRequest } from "next/server";

import { isUuid } from "@/lib/documents/server";
import { FinalizeBusyError, finalizeDocument } from "@/lib/pdf/finalize";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { BUCKET, paths } from "@/lib/storage";

/** "계약서/2026:최종?" → "계약서_2026_최종_" (safe file name, max 120 chars) */
function safeFileName(title: string) {
  const base = title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/\s+/g, " ").trim().slice(0, 120);
  return `${base || "document"}.pdf`;
}

const fail = (error: string, status: number) => NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

/**
 * GET /api/documents/[docId]/download?type=original|completed
 * Logged-in users only. Authorisation = the document is visible to the user under RLS
 * (workspace member or participant). Redirects to a short-lived signed URL that downloads as "<제목>.pdf".
 * A completed document whose PDF could not be generated at completion is generated now.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/documents/[docId]/download">) {
  const { docId } = await ctx.params;
  const type = request.nextUrl.searchParams.get("type") ?? "original";
  if (!isUuid(docId) || (type !== "original" && type !== "completed")) return fail("잘못된 요청입니다.", 400);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("로그인이 필요합니다.", 401);

  const { data: doc } = await supabase
    .from("documents")
    .select("id, workspace_id, title, status, owner_id, file_path, completed_file_path")
    .eq("id", docId)
    .maybeSingle();
  if (!doc || (doc.status === "draft" && doc.owner_id !== user.id)) return fail("문서를 찾을 수 없습니다.", 404);

  // the signed URL is created with the service role: the path is rebuilt from the ids, the stored
  // column only says whether the file exists
  let path: string | null;
  if (type === "completed") {
    if (doc.status !== "completed") return fail("아직 완료 문서가 없습니다.", 404);
    if (!doc.completed_file_path) {
      // generation failed when the last signer signed (or is still running) — build it now
      try {
        await finalizeDocument(doc.id as string);
      } catch (e) {
        if (e instanceof FinalizeBusyError) return fail(e.message, e.failed ? 502 : 409);
        console.error("[download] finalize failed:", (e as Error).message);
        return fail("완료 문서를 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.", 502);
      }
    }
    path = paths.documentCompleted(doc.workspace_id as string, doc.id as string);
  } else {
    path = doc.file_path ? paths.documentOriginal(doc.workspace_id as string, doc.id as string) : null;
  }
  if (!path) return fail("원본 문서가 없습니다.", 404);

  const { data, error } = await createAdminClient().storage.from(BUCKET).createSignedUrl(path, 60);
  if (error || !data?.signedUrl) {
    console.error("[download] signed url failed:", error?.message);
    return fail("파일을 준비하지 못했습니다.", 502);
  }

  // Set `download` ourselves: the SDK option double-encodes non-ASCII (Korean) names, which breaks
  // the filename* header. Encoded once here, storage answers with a proper RFC 6266 Content-Disposition.
  const target = new URL(data.signedUrl);
  target.searchParams.set("download", safeFileName(doc.title as string));

  const res = NextResponse.redirect(target, 302);
  res.headers.set("Cache-Control", "no-store");
  return res;
}
