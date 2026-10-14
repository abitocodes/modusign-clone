import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getWorkspaceContext } from "@/lib/data/session";
import {
  canManage,
  expireOverdueSafe,
  inPersonPending,
  isUuid,
  loadMyPendingTokens,
  loadProgressInfo,
  PARTICIPANT_COLUMNS,
  type RawParticipant,
} from "@/lib/documents/server";
import { paths } from "@/lib/storage";
import { signedUrl } from "@/lib/storage-server";
import { createClient } from "@/lib/supabase/server";
import type { DocStatus, FieldRow, PageSize, RequestType, SigningOrder } from "@/lib/types";

import { DocumentViewer, type ViewerField } from "./document-viewer";

export const metadata: Metadata = { title: "문서 보기 | OpenSign" };

interface ViewerDocRow {
  id: string;
  title: string;
  status: DocStatus;
  request_type: RequestType;
  signing_order: SigningOrder;
  owner_id: string;
  file_path: string | null;
  completed_file_path: string | null;
  page_count: number;
  page_sizes: PageSize[] | null;
  participants: RawParticipant[] | null;
  fields: Pick<FieldRow, "id" | "participant_id" | "type" | "page" | "x" | "y" | "width" | "height" | "required" | "options" | "value" | "filled_at">[] | null;
}

/** Read-only document viewer for requesters / workspace members (full screen, no e-sign shell). */
export default async function DocumentViewerPage({ params }: PageProps<"/workspaces/[wid]/documents/[docId]">) {
  const { wid, docId } = await params;
  if (!isUuid(docId)) notFound();
  const { profile, role } = await getWorkspaceContext(wid);
  await expireOverdueSafe(wid);
  const supabase = await createClient();

  // RLS: only rows the current user may see come back.
  const { data } = await supabase
    .from("documents")
    .select(
      `id, title, status, request_type, signing_order, owner_id, file_path, completed_file_path, page_count, page_sizes,
       participants(${PARTICIPANT_COLUMNS}),
       fields(id, participant_id, type, page, x, y, width, height, required, options, value, filled_at)`,
    )
    .eq("id", docId)
    .eq("workspace_id", wid)
    .maybeSingle();
  const doc = data as ViewerDocRow | null;
  if (!doc || (doc.status === "draft" && doc.owner_id !== profile.id)) notFound();

  const myEmail = profile.email.toLowerCase();
  const participants = doc.participants ?? [];
  const [info, pdfUrl, myTokens] = await Promise.all([
    loadProgressInfo(supabase, wid, docId, profile.id),
    // signed with the service role: the path is rebuilt from the ids, never taken from the row
    doc.file_path ? signedUrl(paths.documentOriginal(wid, doc.id), 60 * 60) : null,
    loadMyPendingTokens(supabase, doc.status === "in_progress" ? [doc.id] : []),
  ]);
  if (!info) notFound();

  const fields: ViewerField[] = (doc.fields ?? []).map((f) => ({
    id: f.id,
    participant_id: f.participant_id,
    type: f.type,
    page: f.page,
    x: f.x,
    y: f.y,
    width: f.width,
    height: f.height,
    required: f.required,
    options: f.options ?? {},
    value: f.value,
    filled_at: f.filled_at,
  }));

  return (
    <DocumentViewer
      wid={wid}
      doc={{
        id: doc.id,
        title: doc.title,
        status: doc.status,
        request_type: doc.request_type,
        signing_order: doc.signing_order,
        hasOriginal: !!doc.file_path,
        // the download route generates a missing completed PDF on demand
        hasCompleted: doc.status === "completed" || !!doc.completed_file_path,
        pageSizes: doc.page_sizes ?? [],
      }}
      info={info}
      fields={fields}
      pdfUrl={pdfUrl}
      myEmail={myEmail}
      myToken={myTokens.get(doc.id) ?? null}
      inPersonPending={inPersonPending(doc, participants, canManage(doc, { userId: profile.id, role }))}
    />
  );
}
