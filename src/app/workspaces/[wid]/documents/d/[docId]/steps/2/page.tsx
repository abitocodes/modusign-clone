import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import type { EditorCustomField, EditorField, EditorParticipant } from "@/components/editor/editor-model";
import { getWorkspaceContext } from "@/lib/data/session";
import { signedUrl } from "@/lib/storage-server";
import { createClient } from "@/lib/supabase/server";
import type { DocumentRow, FieldRow, PageSize, Participant } from "@/lib/types";

import { Step2Client } from "./step2-client";

export const metadata: Metadata = { title: "입력란 배치 | OpenSign" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function FieldPlacementStep({ params }: PageProps<"/workspaces/[wid]/documents/d/[docId]/steps/2">) {
  const { wid, docId } = await params;
  const { profile, role } = await getWorkspaceContext(wid);
  if (!UUID_RE.test(docId)) notFound();

  const supabase = await createClient();
  const { data: docData } = await supabase
    .from("documents")
    .select("id, workspace_id, owner_id, title, status, request_type, signing_order, file_name, file_path, page_count, page_sizes")
    .eq("id", docId)
    .eq("workspace_id", wid)
    .maybeSingle();
  if (!docData) notFound();
  const doc = docData as Pick<
    DocumentRow,
    "id" | "workspace_id" | "owner_id" | "title" | "status" | "request_type" | "signing_order" | "file_name" | "file_path" | "page_count" | "page_sizes"
  >;

  const base = `/workspaces/${wid}/documents`;
  if (doc.status !== "draft" && doc.status !== "on_modifying") redirect(`${base}/${doc.id}`);
  if (doc.owner_id !== profile.id && role === "member") redirect(`${base}/${doc.id}`);
  if (!doc.file_path) redirect(`${base}/d/upload`);

  const [{ data: partData }, { data: fieldData }, { data: customData }, pdfUrl] = await Promise.all([
    supabase.from("participants").select("id, name, role, order_index").eq("document_id", doc.id).order("order_index"),
    supabase
      .from("fields")
      .select("id, participant_id, type, page, x, y, width, height, required, options")
      .eq("document_id", doc.id)
      .order("created_at"),
    supabase
      .from("custom_fields")
      .select("id, name, type, required, placeholder, default_value, options")
      .eq("workspace_id", wid)
      .order("created_at"),
    // long-lived: pdf.js may fetch byte ranges lazily while the editor stays open
    signedUrl(doc.file_path, 60 * 60 * 12),
  ]);

  const parts = (partData ?? []) as Pick<Participant, "id" | "name" | "role" | "order_index">[];
  if (parts.length === 0) redirect(`${base}/d/${doc.id}/steps/1`);

  const who = doc.request_type === "view" ? "열람자" : "서명자";
  const participants: EditorParticipant[] = parts.map((p, i) => ({
    key: p.id,
    name: p.name?.trim() || `${who} ${i + 1}`,
    colorIndex: i,
  }));
  const keys = new Set(participants.map((p) => p.key));
  const fields: EditorField[] = ((fieldData ?? []) as Pick<
    FieldRow,
    "id" | "participant_id" | "type" | "page" | "x" | "y" | "width" | "height" | "required" | "options"
  >[])
    .filter((f) => f.participant_id && keys.has(f.participant_id))
    .map((f) => ({
      id: f.id,
      participantKey: f.participant_id!,
      type: f.type,
      page: f.page,
      x: f.x,
      y: f.y,
      width: f.width,
      height: f.height,
      required: f.required,
      options: f.options ?? {},
    }));

  const pageSizes: PageSize[] = Array.isArray(doc.page_sizes) ? doc.page_sizes : [];
  const fileName = (doc.file_name ?? doc.title).replace(/\.[^.]+$/, "");

  return (
    <Step2Client
      workspaceId={wid}
      documentId={doc.id}
      requestType={doc.request_type}
      documentName={fileName || doc.title}
      pdfUrl={pdfUrl}
      pageSizes={pageSizes}
      participants={participants}
      signerKeys={parts.filter((p) => p.role !== "viewer").map((p) => p.id)}
      initialFields={fields}
      customFields={(customData ?? []) as EditorCustomField[]}
    />
  );
}
