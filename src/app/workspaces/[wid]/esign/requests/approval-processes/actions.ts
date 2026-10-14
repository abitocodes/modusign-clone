"use server";

import { revalidatePath } from "next/cache";

import { APPROVER_LIMIT, LINE_NAME_LIMIT } from "@/lib/tools/approvals";
import { isUuid, type ActionResult } from "@/lib/tools/result";
import { listWorkspaceMembers, requireMember, type MemberGuard } from "@/lib/tools/server";
import type { Approver } from "@/lib/types";

const listPath = (wid: string) => `/workspaces/${wid}/esign/requests/approval-processes`;

export interface ApprovalLineInput {
  name: string;
  approverIds: string[];
}

type Guard = Extract<MemberGuard, { ok: true }>;

async function buildLine(guard: Guard, wid: string, input: ApprovalLineInput) {
  const name = String(input?.name ?? "").trim();
  if (!name) return { error: "결재선 이름을 입력해 주세요." } as const;
  if (name.length > LINE_NAME_LIMIT) return { error: `결재선 이름은 ${LINE_NAME_LIMIT}자 이내로 입력해 주세요.` } as const;

  const ids = Array.isArray(input?.approverIds) ? input.approverIds : [];
  if (ids.length === 0 || ids.some((id) => !id)) return { error: "결재자를 모두 선택해 주세요." } as const;
  if (!ids.every(isUuid)) return { error: "잘못된 요청입니다." } as const;
  if (ids.length > APPROVER_LIMIT) return { error: `결재자는 최대 ${APPROVER_LIMIT}명까지 지정할 수 있습니다.` } as const;
  if (new Set(ids).size !== ids.length) return { error: "같은 결재자가 중복으로 지정되었습니다." } as const;

  const members = await listWorkspaceMembers(guard.supabase, wid);
  const byId = new Map(members.map((m) => [m.id, m]));
  const approvers: Approver[] = [];
  for (const id of ids) {
    const m = byId.get(id);
    if (!m) return { error: "워크스페이스 멤버만 결재자로 지정할 수 있습니다." } as const;
    approvers.push({ user_id: m.id, name: m.name, email: m.email });
  }
  return { name, approvers } as const;
}

export async function createApprovalLine(wid: string, input: ApprovalLineInput): Promise<ActionResult<{ id: string }>> {
  const guard = await requireMember(wid);
  if (!guard.ok) return guard;
  const built = await buildLine(guard, wid, input);
  if ("error" in built) return { ok: false, error: built.error ?? "입력값을 확인해 주세요." };

  const { data, error } = await guard.supabase
    .from("approval_lines")
    .insert({ workspace_id: wid, owner_id: guard.userId, name: built.name, approvers: built.approvers })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "결재선을 추가하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  revalidatePath(listPath(wid));
  return { ok: true, id: data.id as string };
}

async function loadEditable(guard: Guard, wid: string, id: string) {
  if (!isUuid(id)) return { error: "잘못된 요청입니다." } as const;
  const { data } = await guard.supabase.from("approval_lines").select("id, owner_id").eq("id", id).eq("workspace_id", wid).maybeSingle();
  if (!data) return { error: "결재선을 찾을 수 없습니다. 이미 삭제되었을 수 있습니다." } as const;
  if (data.owner_id !== guard.userId && guard.role === "member") {
    return { error: "결재선을 만든 사람 또는 관리자만 변경할 수 있습니다." } as const;
  }
  return { ok: true } as const;
}

export async function updateApprovalLine(wid: string, id: string, input: ApprovalLineInput): Promise<ActionResult> {
  const guard = await requireMember(wid);
  if (!guard.ok) return guard;
  const editable = await loadEditable(guard, wid, id);
  if ("error" in editable) return { ok: false, error: editable.error ?? "잘못된 요청입니다." };
  const built = await buildLine(guard, wid, input);
  if ("error" in built) return { ok: false, error: built.error ?? "입력값을 확인해 주세요." };

  const now = new Date().toISOString();
  const { data, error } = await guard.supabase
    .from("approval_lines")
    .update({ name: built.name, approvers: built.approvers, updated_at: now, last_activity_at: now })
    .eq("id", id)
    .eq("workspace_id", wid)
    .select("id");
  if (error) return { ok: false, error: "결재선을 수정하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  if (!data || data.length === 0) return { ok: false, error: "결재선을 수정할 권한이 없습니다." };
  revalidatePath(listPath(wid));
  return { ok: true };
}

export async function deleteApprovalLine(wid: string, id: string): Promise<ActionResult> {
  const guard = await requireMember(wid);
  if (!guard.ok) return guard;
  const editable = await loadEditable(guard, wid, id);
  if ("error" in editable) return { ok: false, error: editable.error ?? "잘못된 요청입니다." };

  const { data, error } = await guard.supabase.from("approval_lines").delete().eq("id", id).eq("workspace_id", wid).select("id");
  if (error) return { ok: false, error: "결재선을 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  if (!data || data.length === 0) return { ok: false, error: "결재선을 삭제할 권한이 없습니다." };
  revalidatePath(listPath(wid));
  return { ok: true };
}
