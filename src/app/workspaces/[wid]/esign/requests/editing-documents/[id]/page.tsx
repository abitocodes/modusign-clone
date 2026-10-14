import { notFound } from "next/navigation";

import { getWorkspaceContext } from "@/lib/data/session";
import { createClient } from "@/lib/supabase/server";

import { isUuid } from "../../_edit-kit/server";
import { parseAnnotations } from "../annotations";
import { DocumentEditor } from "./document-editor";

export const metadata = { title: "문서 편집기 | OpenSign" };

export default async function EditingDocumentEditorPage({
  params,
}: PageProps<"/workspaces/[wid]/esign/requests/editing-documents/[id]">) {
  const { wid, id } = await params;
  if (!isUuid(id)) notFound();
  const { profile, role } = await getWorkspaceContext(wid);
  const supabase = await createClient();
  const { data } = await supabase
    .from("editing_documents")
    .select("id, owner_id, title, file_path, status, annotations")
    .eq("id", id)
    .eq("workspace_id", wid)
    .maybeSingle();
  if (!data || !data.file_path) notFound();

  const canEdit = data.owner_id === profile.id || role === "owner" || role === "admin";

  return (
    <DocumentEditor
      wid={wid}
      doc={{
        id: data.id as string,
        title: data.title as string,
        filePath: data.file_path as string,
        status: data.status === "done" ? "done" : "editing",
        annotations: parseAnnotations(data.annotations) ?? [],
      }}
      canEdit={canEdit}
    />
  );
}
