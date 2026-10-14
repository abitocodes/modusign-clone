"use server";

import { revalidatePath } from "next/cache";

import { firstError } from "@/lib/tools/contacts";
import { CUSTOM_FIELD_LIMIT, validateCustomField, type CustomFieldInput } from "@/lib/tools/custom-fields";
import { isUuid, type ActionResult } from "@/lib/tools/result";
import { dbErrorMessage, requireMember } from "@/lib/tools/server";

const listPath = (wid: string) => `/workspaces/${wid}/esign/requests/custom-fields`;

function writeError(error: { code?: string; message?: string }, fallback: string) {
  if (error.code === "23505") return "같은 이름의 맞춤 입력란이 이미 있습니다.";
  return dbErrorMessage(error, fallback);
}

export async function createCustomField(wid: string, input: CustomFieldInput): Promise<ActionResult<{ id: string }>> {
  const guard = await requireMember(wid);
  if (!guard.ok) return guard;
  const { values, errors } = validateCustomField(input);
  if (!values) return { ok: false, error: firstError(errors) };

  const { count } = await guard.supabase
    .from("custom_fields")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", wid);
  if ((count ?? 0) >= CUSTOM_FIELD_LIMIT) {
    return { ok: false, error: `맞춤 입력란은 최대 ${CUSTOM_FIELD_LIMIT}개까지 만들 수 있습니다.` };
  }

  const { data, error } = await guard.supabase
    .from("custom_fields")
    .insert({ ...values, workspace_id: wid, owner_id: guard.userId })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: writeError(error ?? {}, "맞춤 입력란을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.") };
  revalidatePath(listPath(wid));
  return { ok: true, id: data.id as string };
}

export async function updateCustomField(wid: string, id: string, input: CustomFieldInput): Promise<ActionResult> {
  const guard = await requireMember(wid);
  if (!guard.ok) return guard;
  if (!isUuid(id)) return { ok: false, error: "잘못된 요청입니다." };
  const { values, errors } = validateCustomField(input);
  if (!values) return { ok: false, error: firstError(errors) };

  const { data, error } = await guard.supabase
    .from("custom_fields")
    .update(values)
    .eq("id", id)
    .eq("workspace_id", wid)
    .select("id");
  if (error) return { ok: false, error: writeError(error, "맞춤 입력란을 수정하지 못했습니다. 잠시 후 다시 시도해 주세요.") };
  if (!data || data.length === 0) return { ok: false, error: "맞춤 입력란을 찾을 수 없습니다. 이미 삭제되었을 수 있습니다." };
  revalidatePath(listPath(wid));
  return { ok: true };
}

export async function deleteCustomField(wid: string, id: string): Promise<ActionResult> {
  const guard = await requireMember(wid);
  if (!guard.ok) return guard;
  if (!isUuid(id)) return { ok: false, error: "잘못된 요청입니다." };
  const { error } = await guard.supabase.from("custom_fields").delete().eq("id", id).eq("workspace_id", wid);
  if (error) return { ok: false, error: "맞춤 입력란을 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  revalidatePath(listPath(wid));
  return { ok: true };
}
