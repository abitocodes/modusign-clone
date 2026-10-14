import type { Metadata } from "next";

import { getWorkspaceContext } from "@/lib/data/session";
import { signedUrl } from "@/lib/storage-server";
import { createClient } from "@/lib/supabase/server";
import { canManageTemplate } from "@/lib/templates/server";
import type { Label, Profile, TemplateRow } from "@/lib/types";

import { TemplatesView, type TemplateListItem } from "./templates-view";

export const metadata: Metadata = { title: "템플릿 | OpenSign" };

type Row = Pick<
  TemplateRow,
  | "id"
  | "owner_id"
  | "title"
  | "request_type"
  | "roles"
  | "fields"
  | "label_ids"
  | "shared"
  | "last_modified_by"
  | "page_count"
  | "file_path"
  | "created_at"
  | "updated_at"
>;

export default async function TemplatesPage({ params }: PageProps<"/workspaces/[wid]/esign/requests/templates">) {
  const { wid } = await params;
  const { profile, role } = await getWorkspaceContext(wid);
  const supabase = await createClient();

  const [{ data, error }, { data: labelData }, { data: pinData }, { data: linkData }] = await Promise.all([
    // RLS: own templates, shared templates, or all of them for workspace admins
    supabase
      .from("templates")
      .select("id, owner_id, title, request_type, roles, fields, label_ids, shared, last_modified_by, page_count, file_path, created_at, updated_at")
      .eq("workspace_id", wid)
      .not("file_path", "is", null)
      .order("updated_at", { ascending: false })
      .limit(1000),
    supabase.from("labels").select("*").eq("workspace_id", wid).order("name"),
    supabase.from("template_pins").select("template_id, created_at").eq("user_id", profile.id),
    supabase.from("link_signs").select("template_id").eq("workspace_id", wid).eq("active", true).not("template_id", "is", null),
  ]);
  if (error) throw new Error("템플릿 목록을 불러오지 못했습니다.");

  const rows = (data ?? []) as Row[];
  const pins = new Map(((pinData ?? []) as { template_id: string; created_at: string }[]).map((p) => [p.template_id, p.created_at]));
  const activeLinks = new Map<string, number>();
  for (const l of (linkData ?? []) as { template_id: string }[]) activeLinks.set(l.template_id, (activeLinks.get(l.template_id) ?? 0) + 1);

  const personIds = Array.from(new Set(rows.flatMap((r) => [r.owner_id, r.last_modified_by]).filter((v): v is string => !!v)));
  const { data: people } = personIds.length
    ? await supabase.from("profiles").select("id, name").in("id", personIds)
    : { data: [] as Pick<Profile, "id" | "name">[] };
  const names = new Map(((people ?? []) as Pick<Profile, "id" | "name">[]).map((p) => [p.id, p.name]));

  const items: TemplateListItem[] = await Promise.all(
    rows.map(async (r) => {
      const roles = Array.isArray(r.roles) ? r.roles : [];
      const pinnedAt = pins.get(r.id) ?? null;
      return {
        id: r.id,
        title: r.title,
        requestType: r.request_type,
        roleNames: roles.map((x) => x.name),
        fieldCount: Array.isArray(r.fields) ? r.fields.length : 0,
        pageCount: r.page_count,
        labelIds: r.label_ids ?? [],
        shared: r.shared,
        isMine: r.owner_id === profile.id,
        canManage: canManageTemplate(r, profile.id, role),
        ownerName: names.get(r.owner_id) ?? null,
        modifierName: names.get(r.last_modified_by ?? r.owner_id) ?? null,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        pinnedAt,
        activeLinks: activeLinks.get(r.id) ?? 0,
        // only pinned cards show a page thumbnail (rows above were read with the member's RLS session)
        thumbUrl: pinnedAt ? await signedUrl(r.file_path, 60 * 60) : null,
      };
    }),
  );

  return <TemplatesView wid={wid} items={items} labels={(labelData ?? []) as Label[]} />;
}
