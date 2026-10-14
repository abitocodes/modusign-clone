"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { BUCKET, MAX_PDF_BYTES, paths } from "@/lib/storage";
import type { DocumentRow } from "@/lib/types";

import { authorizeDocument, authorizeWorkspace } from "../_lib/access";
import type { ActionResult, CreateDraftInput } from "../_lib/types";

const MAX_PAGES = 500;

/** "%PDF-" within the first KiB (the PDF spec allows leading bytes before the header) */
function isPdfHeader(bytes: Uint8Array) {
  const marker = [0x25, 0x50, 0x44, 0x46, 0x2d];
  for (let i = 0; i + marker.length <= bytes.length; i++) {
    if (marker.every((b, j) => bytes[i + j] === b)) return true;
  }
  return false;
}

function validPageSize(s: unknown): s is { w: number; h: number } {
  if (!s || typeof s !== "object") return false;
  const { w, h } = s as { w: unknown; h: unknown };
  return typeof w === "number" && typeof h === "number" && Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 && w <= 14400 && h <= 14400;
}

/** Creates the draft `documents` row for an upload (file is uploaded by the browser afterwards). */
export async function createDraftDocument(wid: string, input: CreateDraftInput): Promise<ActionResult<{ id: string; path: string }>> {
  const auth = await authorizeWorkspace(wid);
  if (!auth.ok) return auth;

  const title = String(input?.title ?? "").trim().slice(0, 100) || "제목 없는 문서";
  const fileName = String(input?.fileName ?? "").trim().slice(0, 200) || `${title}.pdf`;
  const pageCount = Number(input?.pageCount);
  if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > MAX_PAGES)
    return { ok: false, error: "문서의 페이지 정보를 읽지 못했습니다." };
  if (!Array.isArray(input.pageSizes) || input.pageSizes.length !== pageCount || !input.pageSizes.every(validPageSize))
    return { ok: false, error: "문서의 페이지 정보를 읽지 못했습니다." };
  const size = Number(input.sizeBytes);
  if (!Number.isFinite(size) || size <= 0) return { ok: false, error: "빈 문서는 업로드할 수 없습니다." };
  if (size > MAX_PDF_BYTES) return { ok: false, error: "문서는 최대 10MB까지 업로드할 수 있습니다." };

  // id generated here: INSERT … RETURNING would be checked against documents_select
  // (can_view_document cannot see the row being inserted), so no `.select()` on the insert.
  const id = randomUUID();
  const { error } = await auth.supabase.from("documents").insert({
    id,
    workspace_id: wid,
    owner_id: auth.userId,
    title,
    status: "draft",
    file_name: fileName,
    page_count: pageCount,
    page_sizes: input.pageSizes.map((s) => ({ w: Math.round(s.w * 100) / 100, h: Math.round(s.h * 100) / 100 })),
  });
  if (error) return { ok: false, error: "문서를 만들지 못했습니다. 잠시 후 다시 시도해 주세요." };

  return { ok: true, id, path: paths.documentOriginal(wid, id) };
}

/** After the browser upload: verifies the object exists and links it to the draft. */
export async function attachUploadedFile(docId: string): Promise<ActionResult> {
  const auth = await authorizeDocument(docId);
  if (!auth.ok) return auth;
  const { doc, supabase } = auth;
  const path = paths.documentOriginal(doc.workspace_id, doc.id);
  const folder = path.slice(0, path.lastIndexOf("/"));
  const { data: objects } = await supabase.storage.from(BUCKET).list(folder, { search: "original.pdf" });
  const object = objects?.find((o) => o.name === "original.pdf");
  if (!object) return { ok: false, error: "업로드한 파일을 찾을 수 없습니다. 다시 시도해 주세요." };
  // the bucket limit is sized for generated PDFs: enforce the 10 MB upload limit from the stored object
  const size = Number((object.metadata as { size?: number } | null)?.size ?? 0);
  if (!Number.isFinite(size) || size > MAX_PDF_BYTES) {
    await supabase.storage.from(BUCKET).remove([path]);
    return { ok: false, error: "문서는 최대 10MB까지 업로드할 수 있습니다." };
  }
  // the browser chooses the Content-Type: check that the object really is a PDF
  const { data: blob } = await supabase.storage.from(BUCKET).download(path);
  const head = blob ? new Uint8Array(await blob.slice(0, 1024).arrayBuffer()) : null;
  if (!head || !isPdfHeader(head)) {
    await supabase.storage.from(BUCKET).remove([path]);
    return { ok: false, error: "PDF 파일이 아닙니다. 다시 업로드해 주세요." };
  }

  const { error } = await supabase
    .from("documents")
    .update({ file_path: path, last_activity_at: new Date().toISOString() })
    .eq("id", doc.id);
  if (error) return { ok: false, error: "문서를 저장하지 못했습니다." };
  revalidatePath(`/workspaces/${doc.workspace_id}/esign/documents/documents`);
  return { ok: true };
}

/** Removes a draft whose upload failed (row + any uploaded object). */
export async function discardFailedDraft(docId: string): Promise<ActionResult> {
  const auth = await authorizeDocument(docId);
  if (!auth.ok) return auth;
  const doc: DocumentRow = auth.doc;
  if (doc.status !== "draft" || doc.file_path) return { ok: false, error: "삭제할 수 없는 문서입니다." };
  await auth.supabase.storage.from(BUCKET).remove([paths.documentOriginal(doc.workspace_id, doc.id)]);
  await auth.supabase.from("documents").delete().eq("id", doc.id);
  return { ok: true };
}
