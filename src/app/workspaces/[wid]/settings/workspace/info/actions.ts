"use server";

import { revalidatePath } from "next/cache";

import type { ActionResult } from "@/components/settings/shared";
import { isAdminRole, NAME_MAX } from "@/components/settings/shared";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import { dbErrorMessage, getCaller, getCompanyWorkspaceId, isUuid } from "../../_lib/server";

/** 워크스페이스 이름 변경 (owner/admin) */
export async function renameWorkspace(wid: string, rawName: string): Promise<ActionResult> {
  const name = String(rawName ?? "").trim().replace(/\s+/g, " ");
  if (!name) return { ok: false, error: "워크스페이스 이름을 입력해 주세요." };
  if (name.length > NAME_MAX) return { ok: false, error: `워크스페이스 이름은 ${NAME_MAX}자 이내로 입력해 주세요.` };

  const caller = await getCaller(wid);
  if (!caller) return { ok: false, error: "워크스페이스를 찾을 수 없습니다." };
  if (!isAdminRole(caller.role)) return { ok: false, error: "최고 관리자 또는 관리자만 이름을 변경할 수 있습니다." };

  const supabase = await createClient();
  const { data: updated, error } = await supabase.from("workspaces").update({ name }).eq("id", wid).select("id");
  if (error) return { ok: false, error: dbErrorMessage(error) };
  if (!updated?.length) return { ok: false, error: "이름을 변경할 권한이 없습니다." };

  revalidatePath(`/workspaces/${wid}`, "layout");
  return { ok: true, data: null };
}

/** 최고 관리자 변경 (owner only) — the previous 최고 관리자 becomes 관리자. */
export async function transferOwnership(wid: string, userId: string): Promise<ActionResult> {
  if (!isUuid(userId)) return { ok: false, error: "변경할 멤버를 선택해 주세요." };
  const caller = await getCaller(wid);
  if (!caller) return { ok: false, error: "워크스페이스를 찾을 수 없습니다." };
  if (caller.role !== "owner") return { ok: false, error: "최고 관리자만 최고 관리자를 변경할 수 있습니다." };
  if (caller.workspaceType === "personal") return { ok: false, error: "개인 워크스페이스의 최고 관리자는 변경할 수 없습니다." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("transfer_workspace_owner", { wid, new_owner: userId });
  if (error) return { ok: false, error: dbErrorMessage(error) };

  revalidatePath(`/workspaces/${wid}`, "layout");
  return { ok: true, data: null };
}

/**
 * 워크스페이스 삭제 — the company workspace and personal workspaces cannot be deleted.
 * Other team workspaces can be deleted by an owner. Returns where to go next.
 */
export async function deleteWorkspace(wid: string, confirmName: string): Promise<ActionResult<{ redirectTo: string }>> {
  const caller = await getCaller(wid);
  if (!caller) return { ok: false, error: "워크스페이스를 찾을 수 없습니다." };
  if (caller.workspaceType === "personal") return { ok: false, error: "개인 워크스페이스는 삭제할 수 없습니다." };
  if ((await getCompanyWorkspaceId()) === wid) return { ok: false, error: "회사 워크스페이스는 삭제할 수 없습니다." };
  if (caller.role !== "owner") return { ok: false, error: "최고 관리자만 워크스페이스를 삭제할 수 있습니다." };

  const admin = createAdminClient();
  const { data: ws } = await admin.from("workspaces").select("name").eq("id", wid).single();
  if (!ws || ws.name !== String(confirmName ?? "").trim()) {
    return { ok: false, error: "워크스페이스 이름이 일치하지 않습니다." };
  }

  const { error } = await admin.from("workspaces").delete().eq("id", wid);
  if (error) return { ok: false, error: dbErrorMessage(error) };

  const { data: rest } = await admin
    .from("workspace_members")
    .select("workspace_id, is_default")
    .eq("user_id", caller.userId)
    .order("is_default", { ascending: false })
    .limit(1);
  const next = rest?.[0]?.workspace_id;
  revalidatePath("/", "layout");
  return { ok: true, data: { redirectTo: next ? `/workspaces/${next}/esign/home` : "/" } };
}
