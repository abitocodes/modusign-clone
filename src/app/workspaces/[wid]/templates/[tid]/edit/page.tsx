import { randomUUID } from "node:crypto";

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import type { EditorCustomField } from "@/components/editor/editor-model";
import { getWorkspaceContext } from "@/lib/data/session";
import { paths } from "@/lib/storage";
import { signedUrl } from "@/lib/storage-server";
import { createClient } from "@/lib/supabase/server";
import { isUuid, toEditorFields } from "@/lib/templates/model";
import { canManageTemplate } from "@/lib/templates/server";
import type { Label, PageSize, TemplateRow } from "@/lib/types";

import { TemplateEditor } from "../../_components/template-editor";

export const metadata: Metadata = { title: "템플릿 수정 | OpenSign" };

export default async function EditTemplatePage({ params }: PageProps<"/workspaces/[wid]/templates/[tid]/edit">) {
  const { wid, tid } = await params;
  const { profile, role } = await getWorkspaceContext(wid);
  if (!isUuid(tid)) notFound();

  const supabase = await createClient();
  const { data } = await supabase.from("templates").select("*").eq("id", tid).eq("workspace_id", wid).maybeSingle();
  const t = data as TemplateRow | null;
  if (!t) notFound();
  if (!canManageTemplate(t, profile.id, role)) redirect(`/workspaces/${wid}/esign/requests/templates`);

  const [{ data: labels }, { data: customFields }, url] = await Promise.all([
    supabase.from("labels").select("*").eq("workspace_id", wid).order("name"),
    supabase
      .from("custom_fields")
      .select("id, name, type, required, placeholder, default_value, options")
      .eq("workspace_id", wid)
      .order("created_at"),
    // long-lived: pdf.js may fetch byte ranges lazily while the editor stays open
    signedUrl(t.file_path ? paths.template(t.workspace_id, t.id) : null, 60 * 60 * 12),
  ]);

  const roles = (Array.isArray(t.roles) ? t.roles : []).map((r) => ({ key: r.key, name: r.name }));
  const pageSizes = (Array.isArray(t.page_sizes) ? t.page_sizes : []) as PageSize[];

  return (
    <TemplateEditor
      wid={wid}
      mode="edit"
      templateId={t.id}
      initial={{
        title: t.title,
        requestType: t.request_type,
        signingOrder: t.signing_order,
        roles,
        fields: toEditorFields(t.fields, new Set(roles.map((r) => r.key)), randomUUID),
        labelIds: t.label_ids ?? [],
        shared: t.shared,
        document: url && pageSizes.length ? { url, name: t.title, pageSizes } : null,
      }}
      labels={(labels ?? []) as Label[]}
      customFields={(customFields ?? []) as EditorCustomField[]}
      canShare
    />
  );
}
