import "server-only";

import { cache } from "react";
import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import type { MemberRole, Profile, Workspace } from "@/lib/types";

export interface WorkspaceSummary {
  id: string;
  name: string;
  type: Workspace["type"];
  role: MemberRole;
  is_default: boolean;
}

export interface WorkspaceContextData {
  profile: Profile;
  workspace: Workspace;
  role: MemberRole;
  workspaces: WorkspaceSummary[];
}

/** Current user + profile. Redirects to /login when signed out. */
export const getSessionProfile = cache(async (): Promise<Profile> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  if (!profile) redirect("/login");
  return profile as Profile;
});

export const getMyWorkspaces = cache(async (): Promise<WorkspaceSummary[]> => {
  const profile = await getSessionProfile();
  const supabase = await createClient();
  const { data } = await supabase
    .from("workspace_members")
    .select("role, is_default, workspaces(id, name, type, created_at)")
    .eq("user_id", profile.id);
  type Row = { role: MemberRole; is_default: boolean; workspaces: { id: string; name: string; type: Workspace["type"]; created_at: string } | null };
  return ((data ?? []) as unknown as Row[])
    .filter((r) => r.workspaces)
    .map((r) => ({ id: r.workspaces!.id, name: r.workspaces!.name, type: r.workspaces!.type, role: r.role, is_default: r.is_default }))
    .sort((a, b) => Number(b.is_default) - Number(a.is_default) || (a.type === "team" ? -1 : 1));
});

export async function getDefaultWorkspaceId(): Promise<string | null> {
  const list = await getMyWorkspaces();
  return list[0]?.id ?? null;
}

/** Loads everything the workspace shell needs. 404s when the user is not a member. */
export const getWorkspaceContext = cache(async (wid: string): Promise<WorkspaceContextData> => {
  const profile = await getSessionProfile();
  const workspaces = await getMyWorkspaces();
  const mine = workspaces.find((w) => w.id === wid);
  if (!mine) notFound();

  const supabase = await createClient();
  const { data: workspace } = await supabase.from("workspaces").select("*").eq("id", wid).single();
  if (!workspace) notFound();


  return { profile, workspace: workspace as Workspace, role: mine.role, workspaces };
});
