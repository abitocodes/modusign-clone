import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { MemberRole, WorkspaceType } from "@/lib/types";
import type { SettingsGroup, SettingsMember } from "@/components/settings/shared";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

export interface Caller {
  userId: string;
  email: string;
  role: MemberRole;
  workspaceType: WorkspaceType;
  workspaceOwnerId: string;
}

/** The signed-in user and their membership of `wid` (null when signed out / not a member). */
export async function getCaller(wid: string): Promise<Caller | null> {
  if (!isUuid(wid)) return null;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("workspace_members")
    .select("role, workspaces(type, owner_id)")
    .eq("workspace_id", wid)
    .eq("user_id", user.id)
    .maybeSingle();
  const row = data as unknown as { role: MemberRole; workspaces: { type: WorkspaceType; owner_id: string } | null } | null;
  if (!row?.workspaces) return null;
  return {
    userId: user.id,
    email: user.email ?? "",
    role: row.role,
    workspaceType: row.workspaces.type,
    workspaceOwnerId: row.workspaces.owner_id,
  };
}

/** The company workspace = the first team workspace (same rule as the handle_new_user trigger). */
export async function getCompanyWorkspaceId(): Promise<string | null> {
  const { data } = await createAdminClient()
    .from("workspaces")
    .select("id")
    .eq("type", "team")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

export async function getRoleIn(wid: string, userId: string): Promise<MemberRole | null> {
  const { data } = await createAdminClient()
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", wid)
    .eq("user_id", userId)
    .maybeSingle();
  return (data?.role as MemberRole | undefined) ?? null;
}

/**
 * Account-level operations (create account, reset password, edit 아이디, delete account) are reserved
 * for owners/admins of the company workspace. Accounts of company owners can only be managed by owners.
 */
export async function canManageAccounts(callerId: string, targetId?: string): Promise<boolean> {
  const company = await getCompanyWorkspaceId();
  if (!company) return false;
  const callerRole = await getRoleIn(company, callerId);
  if (callerRole !== "owner" && callerRole !== "admin") return false;
  if (!targetId) return true;
  const targetRole = await getRoleIn(company, targetId);
  return targetRole !== "owner" || callerRole === "owner";
}

/** Members of a workspace with their profiles (RLS: caller must be a member). */
export async function loadMembers(wid: string): Promise<SettingsMember[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workspace_members")
    .select("role, joined_at, profiles(id, name, email, username, department, position, avatar_color)")
    .eq("workspace_id", wid);
  if (error) throw new Error(error.message);
  type Row = {
    role: MemberRole;
    joined_at: string;
    profiles: Omit<SettingsMember, "role" | "joined_at"> | null;
  };
  return ((data ?? []) as unknown as Row[])
    .filter((r) => r.profiles)
    .map((r) => ({ ...r.profiles!, role: r.role, joined_at: r.joined_at }))
    .sort((a, b) => a.joined_at.localeCompare(b.joined_at) || a.name.localeCompare(b.name, "ko"));
}

/** Groups of a workspace with member ids. */
export async function loadGroups(wid: string): Promise<SettingsGroup[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("groups")
    .select("id, name, created_at, group_members(user_id)")
    .eq("workspace_id", wid)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  type Row = { id: string; name: string; created_at: string; group_members: { user_id: string }[] | null };
  return ((data ?? []) as Row[]).map((g) => ({
    id: g.id,
    name: g.name,
    created_at: g.created_at,
    memberIds: (g.group_members ?? []).map((m) => m.user_id),
  }));
}

/** Maps Postgres / RPC errors raised by the settings migration to Korean messages. */
export function dbErrorMessage(err: { message?: string; code?: string } | null | undefined, fallback = "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.") {
  const m = err?.message ?? "";
  if (m.includes("last_owner")) return "최고 관리자는 최소 1명 이상이어야 합니다.";
  if (m.includes("owner_only")) return "최고 관리자만 할 수 있는 작업입니다.";
  if (m.includes("personal_workspace")) return "개인 워크스페이스에서는 할 수 없는 작업입니다.";
  if (m.includes("not_member")) return "워크스페이스 멤버가 아닙니다.";
  if (m.includes("too_many")) return "최대 20명까지 지정할 수 있습니다.";
  if (m.includes("identity_admin_only")) return "아이디와 이메일은 관리자만 변경할 수 있습니다.";
  if (m.includes("forbidden") || err?.code === "42501") return "권한이 없습니다.";
  if (err?.code === "23505") return "이미 같은 이름이 있습니다.";
  return fallback;
}

export function settingsPath(wid: string) {
  return `/workspaces/${wid}/settings`;
}
