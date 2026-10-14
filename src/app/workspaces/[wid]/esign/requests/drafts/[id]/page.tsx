import { notFound } from "next/navigation";

import { getWorkspaceContext } from "@/lib/data/session";
import { createClient } from "@/lib/supabase/server";

import { isUuid } from "../../_edit-kit/server";
import { sanitizeDraftHtml } from "../sanitize";
import { DraftEditor } from "./draft-editor";

export const metadata = { title: "서식 작성기 | OpenSign" };

export default async function DraftEditorPage({ params }: PageProps<"/workspaces/[wid]/esign/requests/drafts/[id]">) {
  const { wid, id } = await params;
  if (!isUuid(id)) notFound();
  const { profile, role } = await getWorkspaceContext(wid);
  const supabase = await createClient();
  const { data } = await supabase
    .from("drafts")
    .select("id, owner_id, title, content, updated_at")
    .eq("id", id)
    .eq("workspace_id", wid)
    .maybeSingle();
  if (!data) notFound();

  return (
    <DraftEditor
      wid={wid}
      draft={{
        id: data.id as string,
        title: data.title as string,
        // stored content is sanitised on save; sanitise again in case a row was written elsewhere
        content: sanitizeDraftHtml((data.content as string) ?? ""),
        updatedAt: data.updated_at as string,
      }}
      canEdit={data.owner_id === profile.id || role === "owner" || role === "admin"}
    />
  );
}
