"use server";

import { revalidatePath } from "next/cache";

import { type ActionResult, NAME_MAX, ORG_MAX } from "@/components/settings/shared";
import { createClient } from "@/lib/supabase/server";

import { dbErrorMessage, isUuid } from "../../_lib/server";

export interface MyProfileInput {
  name: string;
  department?: string;
  position?: string;
}

/** 내 멤버 정보 수정 (이름 · 부서 · 직위). 아이디와 이메일은 관리자만 바꿀 수 있습니다. */
export async function updateMyProfile(wid: string, input: MyProfileInput): Promise<ActionResult> {
  const name = String(input?.name ?? "").trim().replace(/\s+/g, " ");
  const department = String(input?.department ?? "").trim() || null;
  const position = String(input?.position ?? "").trim() || null;
  if (!name) return { ok: false, error: "이름을 입력해 주세요." };
  if (name.length > NAME_MAX) return { ok: false, error: `이름은 ${NAME_MAX}자 이내로 입력해 주세요.` };
  if ((department?.length ?? 0) > ORG_MAX || (position?.length ?? 0) > ORG_MAX) {
    return { ok: false, error: `부서와 직위는 ${ORG_MAX}자 이내로 입력해 주세요.` };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다." };

  const { data: updated, error } = await supabase
    .from("profiles")
    .update({ name, department, position })
    .eq("id", user.id)
    .select("id");
  if (error) return { ok: false, error: dbErrorMessage(error, "정보를 저장하지 못했습니다.") };
  if (!updated?.length) return { ok: false, error: "정보를 저장하지 못했습니다." };

  // keep auth metadata in sync (merged by Supabase Auth)
  await supabase.auth.updateUser({ data: { name, department: department ?? "", position: position ?? "" } });

  revalidatePath(isUuid(wid) ? `/workspaces/${wid}` : "/", "layout");
  return { ok: true, data: null };
}
