import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { MemberRole } from "@/lib/types";

import type { MemberOption } from "./approvals";
import { isUuid } from "./result";

export type ServerSupabase = Awaited<ReturnType<typeof createClient>>;

export type MemberGuard =
  | { ok: true; supabase: ServerSupabase; userId: string; email: string; role: MemberRole }
  | { ok: false; error: string };

/** Authorises a Server Action: signed in + member of workspace `wid`. Uses the RLS client. */
export async function requireMember(wid: unknown): Promise<MemberGuard> {
  if (!isUuid(wid)) return { ok: false, error: "잘못된 요청입니다." };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다. 다시 로그인해 주세요." };
  const { data: membership } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", wid)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership) return { ok: false, error: "이 워크스페이스에 접근할 권한이 없습니다." };
  return { ok: true, supabase, userId: user.id, email: (user.email ?? "").toLowerCase(), role: membership.role as MemberRole };
}

/** Members of a workspace (name order) — used for approver pickers. */
export async function listWorkspaceMembers(supabase: ServerSupabase, wid: string): Promise<MemberOption[]> {
  const { data, error } = await supabase
    .from("workspace_members")
    .select("user_id, profiles(id, name, email, department, position)")
    .eq("workspace_id", wid);
  if (error) throw new Error("멤버 목록을 불러오지 못했습니다.");
  type Row = { user_id: string; profiles: MemberOption | null };
  return ((data ?? []) as unknown as Row[])
    .map((r) => r.profiles)
    .filter((p): p is MemberOption => !!p)
    .map((p) => ({ id: p.id, name: p.name, email: p.email, department: p.department, position: p.position }))
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

const RPC_ERRORS: Record<string, string> = {
  not_authenticated: "로그인이 필요합니다. 다시 로그인해 주세요.",
  not_member: "이 워크스페이스에 접근할 권한이 없습니다.",
  not_found: "기안 문서를 찾을 수 없습니다.",
  invalid_title: "기안 제목을 1~100자로 입력해 주세요.",
  invalid_message: "기안 의견은 500자 이내로 입력해 주세요.",
  invalid_comment: "의견은 500자 이내로 입력해 주세요.",
  invalid_file: "업로드한 파일 정보가 올바르지 않습니다.",
  file_missing: "업로드한 PDF 파일을 찾을 수 없습니다. 다시 업로드해 주세요.",
  file_too_large: "10MB 이하의 PDF 파일만 기안할 수 있습니다.",
  no_approvers: "결재자를 한 명 이상 지정해 주세요.",
  too_many_approvers: "결재자는 최대 10명까지 지정할 수 있습니다.",
  duplicate_approver: "같은 결재자가 중복으로 지정되었습니다.",
  self_approver: "기안자 본인은 결재자로 지정할 수 없습니다.",
  approver_not_member: "워크스페이스 멤버만 결재자로 지정할 수 있습니다.",
  not_in_progress: "이미 종료된 결재입니다.",
  not_your_turn: "지금은 결재할 차례가 아닙니다.",
  comment_required: "반려 사유를 입력해 주세요.",
  custom_fields_limit: "맞춤 입력란은 최대 30개까지 만들 수 있습니다.",
};

/** Maps an error raised by the SQL functions / triggers of this area to Korean copy. */
export function dbErrorMessage(err: { message?: string; code?: string } | null | undefined, fallback: string) {
  if (!err?.message) return fallback;
  const msg = err.message;
  if (RPC_ERRORS[msg]) return RPC_ERRORS[msg];
  const key = Object.keys(RPC_ERRORS)
    .sort((a, b) => b.length - a.length)
    .find((k) => msg.includes(k));
  return key ? RPC_ERRORS[key] : fallback;
}
