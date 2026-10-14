import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getWorkspaceContext } from "@/lib/data/session";
import { isUuid, loadProgressInfo, myPendingToken, PARTICIPANT_COLUMNS, type RawParticipant } from "@/lib/documents/server";
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
  const { profile } = await getWorkspaceContext(wid);
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
  const [info, pdfUrl] = await Promise.all([loadProgressInfo(supabase, wid, docId, profile.id), signedUrl(doc.file_path, 60 * 60)]);
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
        hasCompleted: !!doc.completed_file_path,
        pageSizes: doc.page_sizes ?? [],
      }}
      info={info}
      fields={fields}
      pdfUrl={pdfUrl}
      myEmail={myEmail}
      myToken={doc.status === "in_progress" ? myPendingToken(participants, myEmail) : null}
    />
  );
}
