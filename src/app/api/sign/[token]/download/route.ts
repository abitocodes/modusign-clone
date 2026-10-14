import { NextResponse, type NextRequest } from "next/server";

import { buildPreviewPdf, finalizeDocument } from "@/lib/pdf/finalize";
import { BUCKET } from "@/lib/storage";

import { isVerified, loadSignContext, safePdfName } from "@/app/sign/[token]/_lib/server";

/**
 * GET /api/sign/[token]/download?type=original|completed|current|audit
 *
 * Public (signer) download. Authorisation = the participant's access token + the identity-check
 * cookie (or 직접 대면 / the invited employee's own session), see `isVerified`.
 *  - original   the uploaded PDF
 *  - completed  the completed PDF (generated again on demand if it is missing)
 *  - current    on-the-fly PDF of a document in progress with every value submitted so far
 *  - audit      the separate 감사 추적 인증서 of a completed document
 * Without `type`: completed when available, otherwise current.
 */

type Kind = "original" | "completed" | "current" | "audit";
const KINDS: Kind[] = ["original", "completed", "current", "audit"];

const error = (message: string, status: number) =>
  NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });

function pdfResponse(bytes: Uint8Array, fileName: string) {
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="document.pdf"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(request: NextRequest, ctx: RouteContext<"/api/sign/[token]/download">) {
  const { token } = await ctx.params;
  const requested = request.nextUrl.searchParams.get("type");
  if (requested !== null && !KINDS.includes(requested as Kind)) return error("잘못된 요청입니다.", 400);

  const sign = await loadSignContext(token);
  if (!sign) return error("유효하지 않은 서명 링크입니다.", 404);
  const { doc, me, admin } = sign;

  // only people the request was actually sent to, and never for withdrawn requests
  if (["draft", "on_modifying", "scheduled"].includes(doc.status) || !me.sent_at) return error("문서를 찾을 수 없습니다.", 404);
  if (doc.status === "request_cancelled" || doc.status === "signing_cancelled") return error("서명 요청이 취소된 문서입니다.", 410);
  if (!(await isVerified(me))) return error("본인 확인이 필요합니다.", 403);

  const kind: Kind = requested ? (requested as Kind) : doc.status === "completed" ? "completed" : "current";

  if (kind === "current") {
    try {
      return pdfResponse(await buildPreviewPdf(doc.id), safePdfName(doc.title));
    } catch (e) {
      console.error("[sign download] preview failed:", (e as Error).message);
      return error("문서를 준비하지 못했습니다.", 502);
    }
  }

  let path: string | null = null;
  let fileName = safePdfName(doc.title);
  if (kind === "original") {
    path = doc.file_path;
  } else {
    if (doc.status !== "completed") return error("아직 서명이 완료되지 않은 문서입니다.", 409);
    path = kind === "audit" ? (doc.audit_file_path ?? null) : doc.completed_file_path;
    if (kind === "audit") fileName = "감사 추적 인증서.pdf";
    if (!path) {
      // the generation failed when the last signer signed — build it now
      try {
        const result = await finalizeDocument(doc.id);
        return pdfResponse(kind === "audit" ? result.auditBytes : result.completedBytes, fileName);
      } catch (e) {
        console.error("[sign download] finalize failed:", (e as Error).message);
        return error("완료 문서를 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.", 502);
      }
    }
  }
  if (!path) return error("문서 파일이 없습니다.", 404);

  const { data, error: urlError } = await admin.storage.from(BUCKET).createSignedUrl(path, 60);
  if (urlError || !data?.signedUrl) {
    console.error("[sign download] signed url failed:", urlError?.message);
    return error("파일을 준비하지 못했습니다.", 502);
  }
  // `download` is set here (encoded once) so storage answers with a proper Content-Disposition
  const target = new URL(data.signedUrl);
  target.searchParams.set("download", fileName);
  const res = NextResponse.redirect(target, 302);
  res.headers.set("Cache-Control", "no-store");
  return res;
}
