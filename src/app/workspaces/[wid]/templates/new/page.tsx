import type { Metadata } from "next";

import type { EditorCustomField } from "@/components/editor/editor-model";
import { getWorkspaceContext } from "@/lib/data/session";
import { createClient } from "@/lib/supabase/server";
import type { Label } from "@/lib/types";

import { TemplateEditor } from "../_components/template-editor";

export const metadata: Metadata = { title: "템플릿 등록 | OpenSign" };

export default async function NewTemplatePage({ params }: PageProps<"/workspaces/[wid]/templates/new">) {
  const { wid } = await params;
  await getWorkspaceContext(wid); // 404 for non-members
  const supabase = await createClient();
  const [{ data: labels }, { data: customFields }] = await Promise.all([
    supabase.from("labels").select("*").eq("workspace_id", wid).order("name"),
    supabase
      .from("custom_fields")
      .select("id, name, type, required, placeholder, default_value, options")
      .eq("workspace_id", wid)
      .order("created_at"),
  ]);

  return (
    <TemplateEditor
      wid={wid}
      mode="new"
      initial={{
        title: "",
        requestType: "sign",
        signingOrder: "sequential",
        roles: [],
        fields: [],
        labelIds: [],
        shared: false,
        document: null,
      }}
      labels={(labels ?? []) as Label[]}
      customFields={(customFields ?? []) as EditorCustomField[]}
      canShare
    />
  );
}
