"use server";

import { revalidatePath } from "next/cache";

import {
  type ActionResult,
  EMAIL_RE,
  isAdminRole,
  NAME_MAX,
  ORG_MAX,
  passwordProblem,
  usernameProblem,
} from "@/components/settings/shared";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { MemberRole } from "@/lib/types";

import { canManageAccounts, dbErrorMessage, getCaller, getCompanyWorkspaceId, getRoleIn, isUuid } from "../../_lib/server";

const ROLES: MemberRole[] = ["owner", "admin", "member"];
const clean = (v: unknown) => String(v ?? "").trim().replace(/\s+/g, " ");
const optional = (v: unknown) => clean(v) || null;

function revalidateSettings(wid: string) {
  revalidatePath(`/workspaces/${wid}/settings`, "layout");
}

/* ------------------------------------------------------------------ 멤버 추가 */

export interface AddMemberInput {
  name: string;
  username: string;
  email: string;
  password: string;
  department?: string;
  position?: string;
  role: "admin" | "member";
}

/**
 * Creates an employee account (auth.admin.createUser → handle_new_user trigger adds the profile,
 * the company membership and a personal workspace) and makes sure it is a member of `wid`.
 * When the e-mail already belongs to an employee, that account is added to this workspace instead.
 */
export async function addMember(wid: string, input: AddMemberInput): Promise<ActionResult<{ existing: boolean }>> {
  const name = clean(input?.name);
  const username = clean(input?.username).toLowerCase();
  const email = clean(input?.email).toLowerCase();
  const password = String(input?.password ?? "");
  const department = optional(input?.department);
  const position = optional(input?.position);
  const role: MemberRole = input?.role === "admin" ? "admin" : "member";

  if (!name) return { ok: false, error: "이름을 입력해 주세요." };
  if (name.length > NAME_MAX) return { ok: false, error: `이름은 ${NAME_MAX}자 이내로 입력해 주세요.` };
  if (!EMAIL_RE.test(email) || email.length > 254) return { ok: false, error: "올바른 이메일 주소를 입력해 주세요." };
  if ((department?.length ?? 0) > ORG_MAX || (position?.length ?? 0) > ORG_MAX) {
    return { ok: false, error: `부서와 직위는 ${ORG_MAX}자 이내로 입력해 주세요.` };
  }

  const caller = await getCaller(wid);
  if (!caller) return { ok: false, error: "워크스페이스를 찾을 수 없습니다." };
  if (!isAdminRole(caller.role)) return { ok: false, error: "최고 관리자 또는 관리자만 멤버를 추가할 수 있습니다." };
  if (caller.workspaceType === "personal") return { ok: false, error: "개인 워크스페이스에는 멤버를 추가할 수 없습니다." };

  const admin = createAdminClient();

  // Existing employee → membership only.
  const { data: existing } = await admin.from("profiles").select("id").eq("email", email).maybeSingle();
  if (existing) {
    if (await getRoleIn(wid, existing.id)) return { ok: false, error: "이미 이 워크스페이스에 등록된 이메일입니다." };
    const { error } = await admin
      .from("workspace_members")
      .insert({ workspace_id: wid, user_id: existing.id, role, is_default: false });
    if (error) return { ok: false, error: dbErrorMessage(error, "멤버를 추가하지 못했습니다.") };
    revalidateSettings(wid);
    return { ok: true, data: { existing: true } };
  }

  // New account.
  const uErr = usernameProblem(username);
  if (uErr) return { ok: false, error: uErr };
  const pErr = passwordProblem(password);
  if (pErr) return { ok: false, error: pErr };
  if (!(await canManageAccounts(caller.userId))) {
    return { ok: false, error: "새 계정은 회사 워크스페이스의 최고 관리자 또는 관리자만 만들 수 있습니다." };
  }
  const { data: taken } = await admin.from("profiles").select("id").eq("username", username).maybeSingle();
  if (taken) return { ok: false, error: "이미 사용 중인 아이디입니다." };

  const company = await getCompanyWorkspaceId();
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      name,
      username,
      department: department ?? "",
      position: position ?? "",
      // the trigger applies this role to the company workspace only
      role: company === wid ? role : "member",
    },
  });
  if (createErr || !created.user) {
    const msg = createErr?.message ?? "";
    if (/already|registered|exists/i.test(msg)) return { ok: false, error: "이미 등록된 이메일입니다." };
    if (/password/i.test(msg)) return { ok: false, error: "비밀번호가 보안 정책에 맞지 않습니다. 다른 비밀번호를 입력해 주세요." };
    return { ok: false, error: "계정을 만들지 못했습니다. 입력값을 확인해 주세요." };
  }

  const { error: memberErr } = await admin
    .from("workspace_members")
    .upsert({ workspace_id: wid, user_id: created.user.id, role, is_default: company === wid }, { onConflict: "workspace_id,user_id" });
  if (memberErr) {
    await admin.auth.admin.deleteUser(created.user.id);
    return { ok: false, error: "멤버를 워크스페이스에 추가하지 못했습니다." };
  }

  revalidateSettings(wid);
  return { ok: true, data: { existing: false } };
}

/* ------------------------------------------------------------------ 역할 변경 */

export async function changeMemberRole(wid: string, userId: string, role: MemberRole): Promise<ActionResult> {
  if (!isUuid(userId) || !ROLES.includes(role)) return { ok: false, error: "잘못된 요청입니다." };
  const caller = await getCaller(wid);
  if (!caller) return { ok: false, error: "워크스페이스를 찾을 수 없습니다." };
  if (!isAdminRole(caller.role)) return { ok: false, error: "최고 관리자 또는 관리자만 역할을 변경할 수 있습니다." };
  if (role === "owner" && caller.role !== "owner") return { ok: false, error: "최고 관리자만 최고 관리자 역할을 부여할 수 있습니다." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_workspace_member_role", { wid, uid: userId, new_role: role });
  if (error) return { ok: false, error: dbErrorMessage(error) };

  revalidatePath(`/workspaces/${wid}`, "layout");
  return { ok: true, data: null };
}

/* ------------------------------------------------------------ 비밀번호 초기화 */

export async function resetMemberPassword(wid: string, userId: string, password: string): Promise<ActionResult> {
  if (!isUuid(userId)) return { ok: false, error: "잘못된 요청입니다." };
  const pErr = passwordProblem(String(password ?? ""));
  if (pErr) return { ok: false, error: pErr };

  const caller = await getCaller(wid);
  if (!caller) return { ok: false, error: "워크스페이스를 찾을 수 없습니다." };
  if (!isAdminRole(caller.role)) return { ok: false, error: "최고 관리자 또는 관리자만 비밀번호를 초기화할 수 있습니다." };
  if (userId === caller.userId) return { ok: false, error: "본인의 비밀번호는 개인 설정 > 비밀번호 변경에서 변경해 주세요." };
  if (!(await getRoleIn(wid, userId))) return { ok: false, error: "워크스페이스 멤버가 아닙니다." };
  if (!(await canManageAccounts(caller.userId, userId))) return { ok: false, error: "이 멤버의 비밀번호를 초기화할 권한이 없습니다." };

  const { error } = await createAdminClient().auth.admin.updateUserById(userId, { password });
  if (error) {
    return { ok: false, error: /password/i.test(error.message) ? "비밀번호가 보안 정책에 맞지 않습니다." : "비밀번호를 초기화하지 못했습니다." };
  }
  return { ok: true, data: null };
}

/* ------------------------------------------------------------------ 정보 수정 */

export interface MemberInfoInput {
  name: string;
  username: string;
  department?: string;
  position?: string;
}

export async function updateMemberInfo(wid: string, userId: string, input: MemberInfoInput): Promise<ActionResult> {
  if (!isUuid(userId)) return { ok: false, error: "잘못된 요청입니다." };
  const name = clean(input?.name);
  const username = clean(input?.username).toLowerCase();
  const department = optional(input?.department);
  const position = optional(input?.position);
  if (!name) return { ok: false, error: "이름을 입력해 주세요." };
  if (name.length > NAME_MAX) return { ok: false, error: `이름은 ${NAME_MAX}자 이내로 입력해 주세요.` };
  const uErr = usernameProblem(username);
  if (uErr) return { ok: false, error: uErr };
  if ((department?.length ?? 0) > ORG_MAX || (position?.length ?? 0) > ORG_MAX) {
    return { ok: false, error: `부서와 직위는 ${ORG_MAX}자 이내로 입력해 주세요.` };
  }

  const caller = await getCaller(wid);
  if (!caller) return { ok: false, error: "워크스페이스를 찾을 수 없습니다." };
  if (!isAdminRole(caller.role)) return { ok: false, error: "최고 관리자 또는 관리자만 멤버 정보를 수정할 수 있습니다." };
  if (!(await getRoleIn(wid, userId))) return { ok: false, error: "워크스페이스 멤버가 아닙니다." };
  if (!(await canManageAccounts(caller.userId, userId))) return { ok: false, error: "이 멤버의 정보를 수정할 권한이 없습니다." };

  const admin = createAdminClient();
  const { data: taken } = await admin.from("profiles").select("id").eq("username", username).neq("id", userId).maybeSingle();
  if (taken) return { ok: false, error: "이미 사용 중인 아이디입니다." };

  const { error } = await admin.from("profiles").update({ name, username, department, position }).eq("id", userId);
  if (error) return { ok: false, error: dbErrorMessage(error, "멤버 정보를 수정하지 못했습니다.") };

  // keep auth metadata in sync (used when the account is re-provisioned)
  const { data: authUser } = await admin.auth.admin.getUserById(userId);
  if (authUser?.user) {
    await admin.auth.admin.updateUserById(userId, {
      user_metadata: { ...(authUser.user.user_metadata ?? {}), name, username, department: department ?? "", position: position ?? "" },
    });
  }

  revalidatePath(`/workspaces/${wid}`, "layout");
  return { ok: true, data: null };
}

/* ------------------------------------------------------------------ 멤버 삭제 */

/**
 * Removes the membership. When the member belongs to no other team workspace, the employee account is
 * deleted as well (after handing the content they own in this workspace over to the caller).
 */
export async function removeMember(wid: string, userId: string): Promise<ActionResult<{ accountDeleted: boolean }>> {
  if (!isUuid(userId)) return { ok: false, error: "잘못된 요청입니다." };
  const caller = await getCaller(wid);
  if (!caller) return { ok: false, error: "워크스페이스를 찾을 수 없습니다." };
  if (!isAdminRole(caller.role)) return { ok: false, error: "최고 관리자 또는 관리자만 멤버를 삭제할 수 있습니다." };
  if (caller.workspaceType === "personal") return { ok: false, error: "개인 워크스페이스에서는 멤버를 삭제할 수 없습니다." };
  if (userId === caller.userId) return { ok: false, error: "본인은 삭제할 수 없습니다." };

  const targetRole = await getRoleIn(wid, userId);
  if (!targetRole) return { ok: false, error: "워크스페이스 멤버가 아닙니다." };
  if (userId === caller.workspaceOwnerId) {
    return { ok: false, error: "최고 관리자는 삭제할 수 없습니다. 먼저 최고 관리자를 변경해 주세요." };
  }
  if (targetRole === "owner" && caller.role !== "owner") return { ok: false, error: "최고 관리자만 다른 최고 관리자를 삭제할 수 있습니다." };

  const admin = createAdminClient();
  const { data: memberships } = await admin
    .from("workspace_members")
    .select("workspace_id, workspaces!inner(type)")
    .eq("user_id", userId)
    .neq("workspace_id", wid);
  type M = { workspace_id: string; workspaces: { type: string } };
  const otherTeams = ((memberships ?? []) as unknown as M[]).filter((m) => m.workspaces.type === "team");

  if (otherTeams.length === 0 && (await canManageAccounts(caller.userId, userId))) {
    const { count: ownedTeams } = await admin
      .from("workspaces")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", userId)
      .eq("type", "team");
    if ((ownedTeams ?? 0) > 0) return { ok: false, error: "공용 워크스페이스의 최고 관리자인 계정은 삭제할 수 없습니다." };

    const { error: moveErr } = await admin.rpc("reassign_member_content", { wid, from_uid: userId, to_uid: caller.userId });
    if (moveErr) return { ok: false, error: "멤버의 문서를 이전하지 못해 삭제를 중단했습니다." };
    const { error: delErr } = await admin.auth.admin.deleteUser(userId);
    if (delErr) return { ok: false, error: "계정을 삭제하지 못했습니다." };
    revalidatePath(`/workspaces/${wid}`, "layout");
    return { ok: true, data: { accountDeleted: true } };
  }

  const supabase = await createClient();
  const { data: removed, error } = await supabase
    .from("workspace_members")
    .delete()
    .eq("workspace_id", wid)
    .eq("user_id", userId)
    .select("user_id");
  if (error) return { ok: false, error: dbErrorMessage(error, "멤버를 삭제하지 못했습니다.") };
  if (!removed?.length) return { ok: false, error: "멤버를 삭제할 권한이 없습니다." };

  revalidatePath(`/workspaces/${wid}`, "layout");
  return { ok: true, data: { accountDeleted: false } };
}
