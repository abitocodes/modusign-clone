import { NextResponse, type NextRequest } from "next/server";

import { isUuid } from "@/lib/documents/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { BUCKET } from "@/lib/storage";

/** "계약서/2026:최종?" → "계약서_2026_최종_" (safe file name, max 120 chars) */
function safeFileName(title: string) {
  const base = title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/\s+/g, " ").trim().slice(0, 120);
  return `${base || "document"}.pdf`;
}

/**
 * GET /api/documents/[docId]/download?type=original|completed
 * Logged-in users only. Authorisation = the document is visible to the user under RLS
 * (workspace member or participant). Redirects to a short-lived signed URL that downloads as "<제목>.pdf".
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/documents/[docId]/download">) {
  const { docId } = await ctx.params;
  const type = request.nextUrl.searchParams.get("type") ?? "original";
  if (!isUuid(docId) || (type !== "original" && type !== "completed")) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const { data: doc } = await supabase
    .from("documents")
    .select("id, title, status, owner_id, file_path, completed_file_path")
    .eq("id", docId)
    .maybeSingle();
  if (!doc || (doc.status === "draft" && doc.owner_id !== user.id)) {
    return NextResponse.json({ error: "문서를 찾을 수 없습니다." }, { status: 404 });
  }

  const path = (type === "completed" ? doc.completed_file_path : doc.file_path) as string | null;
  if (!path) {
    return NextResponse.json(
      { error: type === "completed" ? "아직 완료 문서가 없습니다." : "원본 문서가 없습니다." },
      { status: 404 },
    );
  }

  const { data, error } = await createAdminClient().storage.from(BUCKET).createSignedUrl(path, 60);
  if (error || !data?.signedUrl) {
    console.error("[download] signed url failed:", error?.message);
    return NextResponse.json({ error: "파일을 준비하지 못했습니다." }, { status: 502 });
  }

  // Set `download` ourselves: the SDK option double-encodes non-ASCII (Korean) names, which breaks
  // the filename* header. Encoded once here, storage answers with a proper RFC 6266 Content-Disposition.
  const target = new URL(data.signedUrl);
  target.searchParams.set("download", safeFileName(doc.title as string));

  const res = NextResponse.redirect(target, 302);
  res.headers.set("Cache-Control", "no-store");
  return res;
}
