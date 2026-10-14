import type { Metadata } from "next";

import { getWorkspaceContext } from "@/lib/data/session";
import { appUrl } from "@/lib/email/mailer";
import { createClient } from "@/lib/supabase/server";
import { canManageTemplate, loadTemplateOptions } from "@/lib/templates/server";
import type { Label, LinkSign } from "@/lib/types";

import { LinksView, type LinkListItem } from "./links-view";

export const metadata: Metadata = { title: "링크서명 | OpenSign" };

export default async function LinksPage({ params }: PageProps<"/workspaces/[wid]/esign/requests/links">) {
  const { wid } = await params;
  const { profile, role } = await getWorkspaceContext(wid);
  const supabase = await createClient();

  const [{ data, error }, { data: labelData }, templates, { data: docData }] = await Promise.all([
    supabase
      .from("link_signs")
      .select("id, owner_id, template_id, title, token, active, label_ids, created_at, last_activity_at")
      .eq("workspace_id", wid)
      .order("last_activity_at", { ascending: false })
      .limit(1000),
    supabase.from("labels").select("*").eq("workspace_id", wid).order("name"),
    loadTemplateOptions(supabase, wid),
    supabase.from("documents").select("link_sign_id").eq("workspace_id", wid).not("link_sign_id", "is", null).limit(10000),
  ]);
  if (error) throw new Error("링크서명 목록을 불러오지 못했습니다.");
  const rows = (data ?? []) as Pick<LinkSign, "id" | "owner_id" | "template_id" | "title" | "token" | "active" | "label_ids" | "created_at" | "last_activity_at">[];

  const ownerIds = Array.from(new Set(rows.map((r) => r.owner_id)));
  const { data: people } = ownerIds.length ? await supabase.from("profiles").select("id, name").in("id", ownerIds) : { data: [] };
  const names = new Map(((people ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]));
  const templateTitles = new Map(templates.map((t) => [t.id, t.title]));
  const uses = new Map<string, number>();
  for (const d of (docData ?? []) as { link_sign_id: string }[]) uses.set(d.link_sign_id, (uses.get(d.link_sign_id) ?? 0) + 1);

  const items: LinkListItem[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    url: appUrl(`/link/${r.token}`),
    active: r.active,
    ownerName: names.get(r.owner_id) ?? null,
    isMine: r.owner_id === profile.id,
    canManage: canManageTemplate(r, profile.id, role),
    templateTitle: r.template_id ? (templateTitles.get(r.template_id) ?? null) : null,
    templateDeleted: !r.template_id,
    labelIds: r.label_ids ?? [],
    createdAt: r.created_at,
    lastActivityAt: r.last_activity_at,
    uses: uses.get(r.id) ?? 0,
  }));

  return <LinksView wid={wid} items={items} labels={(labelData ?? []) as Label[]} templates={templates} />;
}
