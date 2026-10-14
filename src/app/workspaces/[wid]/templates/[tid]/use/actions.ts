"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { isUuid, type Result } from "@/lib/templates/model";
import { TEMPLATE_USE_COLUMNS, instantiateTemplate, memberRole, type TemplateForUse } from "@/lib/templates/server";

/**
 * 사용하기: creates a draft sign request from the template (PDF copy, empty participants per role,
 * fields) and returns the wizard step-1 URL. Authorised by workspace membership + template
 * visibility (RLS: own, shared, or admin).
 */
export async function startFromTemplate(wid: string, tid: string): Promise<Result<{ href: string }>> {
  if (!isUuid(wid) || !isUuid(tid)) return { ok: false, error: "잘못된 요청입니다." };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다. 다시 로그인해 주세요." };
  if (!(await memberRole(supabase, wid, user.id))) return { ok: false, error: "이 워크스페이스에 접근할 권한이 없습니다." };

  const { data } = await supabase.from("templates").select(TEMPLATE_USE_COLUMNS).eq("id", tid).eq("workspace_id", wid).maybeSingle();
  const template = data as TemplateForUse | null;
  if (!template) return { ok: false, error: "템플릿을 찾을 수 없거나 사용할 권한이 없습니다." };

  const res = await instantiateTemplate({ db: supabase, template, ownerId: user.id });
  if (!res.ok) return res;

  revalidatePath(`/workspaces/${wid}/esign/documents/documents`);
  return { ok: true, href: `/workspaces/${wid}/documents/d/${res.documentId}/steps/1` };
}
