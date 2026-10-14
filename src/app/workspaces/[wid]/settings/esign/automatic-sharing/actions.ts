"use server";

import { revalidatePath } from "next/cache";

import { type ActionResult, AUTO_SHARE_MAX, isAdminRole } from "@/components/settings/shared";
import { createClient } from "@/lib/supabase/server";

import { dbErrorMessage, getCaller, isUuid } from "../../_lib/server";

/**
 * 문서 자동 공유 설정 저장.
 * scope "all" = 모든 서명 요청 문서를 공유받는 멤버 (owner/admin),
 * scope <userId> = 그 멤버가 서명 요청한 문서가 공유되는 멤버 (본인 또는 owner/admin).
 */
export async function setAutoShare(wid: string, scope: string, userIds: string[]): Promise<ActionResult> {
  if (scope !== "all" && !isUuid(scope)) return { ok: false, error: "잘못된 요청입니다." };
  const ids = Array.from(new Set((Array.isArray(userIds) ? userIds : []).filter(isUuid)));
  if (ids.length > AUTO_SHARE_MAX) return { ok: false, error: `최대 ${AUTO_SHARE_MAX}명까지 지정할 수 있습니다.` };

  const caller = await getCaller(wid);
  if (!caller) return { ok: false, error: "워크스페이스를 찾을 수 없습니다." };
  const admin = isAdminRole(caller.role);
  if (scope === "all" && !admin) return { ok: false, error: "최고 관리자 또는 관리자만 변경할 수 있습니다." };
  if (scope !== "all" && scope !== caller.userId && !admin) return { ok: false, error: "다른 멤버의 설정은 관리자만 변경할 수 있습니다." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_auto_share", { wid, scope, user_ids: ids });
  if (error) return { ok: false, error: dbErrorMessage(error) };

  revalidatePath(`/workspaces/${wid}`, "layout");
  return { ok: true, data: null };
}
