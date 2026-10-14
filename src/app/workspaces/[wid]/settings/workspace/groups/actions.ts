"use server";

import { revalidatePath } from "next/cache";

import { type ActionResult, isAdminRole } from "@/components/settings/shared";
import { createClient } from "@/lib/supabase/server";

import { type Caller, dbErrorMessage, getCaller, isUuid } from "../../_lib/server";

const GROUP_NAME_MAX = 30;

function cleanName(v: unknown) {
  return String(v ?? "").trim().replace(/\s+/g, " ");
}

async function requireAdmin(wid: string): Promise<{ error: string } | { caller: Caller }> {
  const caller = await getCaller(wid);
  if (!caller) return { error: "워크스페이스를 찾을 수 없습니다." };
  if (!isAdminRole(caller.role)) return { error: "최고 관리자 또는 관리자만 그룹을 관리할 수 있습니다." };
  return { caller };
}

/** the group must belong to `wid` */
async function groupInWorkspace(wid: string, groupId: string) {
  if (!isUuid(groupId)) return false;
  const supabase = await createClient();
  const { data } = await supabase.from("groups").select("id").eq("id", groupId).eq("workspace_id", wid).maybeSingle();
  return !!data;
}

function done(wid: string) {
  revalidatePath(`/workspaces/${wid}/settings`, "layout");
}

export async function createGroup(wid: string, rawName: string): Promise<ActionResult<{ id: string }>> {
  const name = cleanName(rawName);
  if (!name) return { ok: false, error: "그룹 이름을 입력해 주세요." };
  if (name.length > GROUP_NAME_MAX) return { ok: false, error: `그룹 이름은 ${GROUP_NAME_MAX}자 이내로 입력해 주세요.` };
  if (name === "모든 멤버") return { ok: false, error: "‘모든 멤버’는 기본 그룹 이름이라 사용할 수 없습니다." };
  const auth = await requireAdmin(wid);
  if ("error" in auth) return { ok: false, error: auth.error };

  const supabase = await createClient();
  const { data, error } = await supabase.from("groups").insert({ workspace_id: wid, name }).select("id").single();
  if (error || !data) return { ok: false, error: error?.code === "23505" ? "같은 이름의 그룹이 이미 있습니다." : dbErrorMessage(error) };
  done(wid);
  return { ok: true, data: { id: data.id } };
}

export async function renameGroup(wid: string, groupId: string, rawName: string): Promise<ActionResult> {
  const name = cleanName(rawName);
  if (!name) return { ok: false, error: "그룹 이름을 입력해 주세요." };
  if (name.length > GROUP_NAME_MAX) return { ok: false, error: `그룹 이름은 ${GROUP_NAME_MAX}자 이내로 입력해 주세요.` };
  if (name === "모든 멤버") return { ok: false, error: "‘모든 멤버’는 기본 그룹 이름이라 사용할 수 없습니다." };
  const auth = await requireAdmin(wid);
  if ("error" in auth) return { ok: false, error: auth.error };
  if (!(await groupInWorkspace(wid, groupId))) return { ok: false, error: "그룹을 찾을 수 없습니다." };

  const supabase = await createClient();
  const { error } = await supabase.from("groups").update({ name }).eq("id", groupId).eq("workspace_id", wid);
  if (error) return { ok: false, error: error.code === "23505" ? "같은 이름의 그룹이 이미 있습니다." : dbErrorMessage(error) };
  done(wid);
  return { ok: true, data: null };
}

export async function deleteGroup(wid: string, groupId: string): Promise<ActionResult> {
  const auth = await requireAdmin(wid);
  if ("error" in auth) return { ok: false, error: auth.error };
  if (!(await groupInWorkspace(wid, groupId))) return { ok: false, error: "그룹을 찾을 수 없습니다." };

  const supabase = await createClient();
  const { error } = await supabase.from("groups").delete().eq("id", groupId).eq("workspace_id", wid);
  if (error) return { ok: false, error: dbErrorMessage(error) };
  done(wid);
  return { ok: true, data: null };
}

/** Replaces the member list of a group (only workspace members are kept). */
export async function setGroupMembers(wid: string, groupId: string, userIds: string[]): Promise<ActionResult> {
  const ids = Array.from(new Set((Array.isArray(userIds) ? userIds : []).filter(isUuid)));
  if (ids.length > 500) return { ok: false, error: "한 번에 500명까지 지정할 수 있습니다." };
  const auth = await requireAdmin(wid);
  if ("error" in auth) return { ok: false, error: auth.error };
  if (!(await groupInWorkspace(wid, groupId))) return { ok: false, error: "그룹을 찾을 수 없습니다." };

  const supabase = await createClient();
  const { data: memberRows } = await supabase.from("workspace_members").select("user_id").eq("workspace_id", wid);
  const allowed = new Set((memberRows ?? []).map((r) => r.user_id as string));
  const wanted = ids.filter((id) => allowed.has(id));

  const { data: currentRows, error: curErr } = await supabase.from("group_members").select("user_id").eq("group_id", groupId);
  if (curErr) return { ok: false, error: dbErrorMessage(curErr) };
  const current = new Set((currentRows ?? []).map((r) => r.user_id as string));

  const toAdd = wanted.filter((id) => !current.has(id));
  const toRemove = [...current].filter((id) => !wanted.includes(id));

  if (toRemove.length) {
    const { error } = await supabase.from("group_members").delete().eq("group_id", groupId).in("user_id", toRemove);
    if (error) return { ok: false, error: dbErrorMessage(error) };
  }
  if (toAdd.length) {
    const { error } = await supabase.from("group_members").insert(toAdd.map((user_id) => ({ group_id: groupId, user_id })));
    if (error) return { ok: false, error: dbErrorMessage(error) };
  }
  done(wid);
  return { ok: true, data: null };
}

export async function removeGroupMember(wid: string, groupId: string, userId: string): Promise<ActionResult> {
  if (!isUuid(userId)) return { ok: false, error: "잘못된 요청입니다." };
  const auth = await requireAdmin(wid);
  if ("error" in auth) return { ok: false, error: auth.error };
  if (!(await groupInWorkspace(wid, groupId))) return { ok: false, error: "그룹을 찾을 수 없습니다." };

  const supabase = await createClient();
  const { error } = await supabase.from("group_members").delete().eq("group_id", groupId).eq("user_id", userId);
  if (error) return { ok: false, error: dbErrorMessage(error) };
  done(wid);
  return { ok: true, data: null };
}
