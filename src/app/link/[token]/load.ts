import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/templates/model";
import { TEMPLATE_USE_COLUMNS, singleRoleTemplateIssue, type TemplateForUse } from "@/lib/templates/server";
import type { LinkSign } from "@/lib/types";

export type LinkRow = Pick<LinkSign, "id" | "workspace_id" | "owner_id" | "template_id" | "title" | "token" | "active" | "label_ids">;

export type LinkState =
  | { kind: "missing" }
  | { kind: "inactive"; title: string }
  | { kind: "unavailable"; title: string }
  | { kind: "ready"; link: LinkRow; template: TemplateForUse; ownerName: string; workspaceName: string };

/**
 * Public link lookup (/link/[token]) with the service role — the token is the authorisation.
 * A link only works while it is active, its template still fits (one role, a signature field)
 * and its creator is still a member of the workspace.
 */
export async function loadLink(token: string): Promise<LinkState> {
  if (!isUuid(token)) return { kind: "missing" };
  const admin = createAdminClient();
  const { data } = await admin
    .from("link_signs")
    .select("id, workspace_id, owner_id, template_id, title, token, active, label_ids")
    .eq("token", token.toLowerCase())
    .maybeSingle();
  const link = data as LinkRow | null;
  if (!link) return { kind: "missing" };
  if (!link.active) return { kind: "inactive", title: link.title };
  if (!link.template_id) return { kind: "unavailable", title: link.title };

  const [{ data: t }, { data: member }, { data: owner }, { data: ws }] = await Promise.all([
    admin.from("templates").select(TEMPLATE_USE_COLUMNS).eq("id", link.template_id).eq("workspace_id", link.workspace_id).maybeSingle(),
    admin.from("workspace_members").select("user_id").eq("workspace_id", link.workspace_id).eq("user_id", link.owner_id).maybeSingle(),
    admin.from("profiles").select("name").eq("id", link.owner_id).maybeSingle(),
    admin.from("workspaces").select("name").eq("id", link.workspace_id).maybeSingle(),
  ]);
  const template = t as TemplateForUse | null;
  if (!template || !member || singleRoleTemplateIssue(template, "링크서명")) return { kind: "unavailable", title: link.title };

  return {
    kind: "ready",
    link,
    template,
    ownerName: (owner as { name: string } | null)?.name ?? "요청자",
    workspaceName: (ws as { name: string } | null)?.name ?? "",
  };
}
