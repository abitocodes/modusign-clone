"use server";

import { revalidatePath } from "next/cache";

import { CONTACT_LIMITS, firstError, validateContact, type ContactInput } from "@/lib/tools/contacts";
import { isUuid, type ActionResult } from "@/lib/tools/result";
import { requireMember } from "@/lib/tools/server";

const listPath = (wid: string) => `/workspaces/${wid}/esign/requests/address-book`;

export async function createContact(wid: string, input: ContactInput): Promise<ActionResult<{ id: string }>> {
  const guard = await requireMember(wid);
  if (!guard.ok) return guard;
  const { values, errors } = validateContact(input);
  if (!values) return { ok: false, error: firstError(errors) };

  const { data, error } = await guard.supabase
    .from("contacts")
    .insert({ ...values, workspace_id: wid, owner_id: guard.userId })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "연락처를 추가하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  revalidatePath(listPath(wid));
  return { ok: true, id: data.id as string };
}

export async function updateContact(wid: string, id: string, input: ContactInput): Promise<ActionResult> {
  const guard = await requireMember(wid);
  if (!guard.ok) return guard;
  if (!isUuid(id)) return { ok: false, error: "잘못된 요청입니다." };
  const { values, errors } = validateContact(input);
  if (!values) return { ok: false, error: firstError(errors) };

  const { data, error } = await guard.supabase
    .from("contacts")
    .update(values)
    .eq("id", id)
    .eq("workspace_id", wid)
    .select("id");
  if (error) return { ok: false, error: "연락처를 수정하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  if (!data || data.length === 0) return { ok: false, error: "연락처를 찾을 수 없습니다. 이미 삭제되었을 수 있습니다." };
  revalidatePath(listPath(wid));
  return { ok: true };
}

export async function deleteContacts(wid: string, ids: string[]): Promise<ActionResult<{ count: number }>> {
  const guard = await requireMember(wid);
  if (!guard.ok) return guard;
  const valid = Array.isArray(ids) ? Array.from(new Set(ids.filter(isUuid))) : [];
  if (valid.length === 0) return { ok: false, error: "삭제할 연락처를 선택해 주세요." };
  if (valid.length > 1000) return { ok: false, error: "한 번에 최대 1,000개까지 삭제할 수 있습니다." };

  const { data, error } = await guard.supabase.from("contacts").delete().eq("workspace_id", wid).in("id", valid).select("id");
  if (error) return { ok: false, error: "연락처를 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  revalidatePath(listPath(wid));
  return { ok: true, count: data?.length ?? 0 };
}

export interface ImportContactRow {
  name: string;
  phone: string;
  email: string;
  company: string;
}

export async function importContacts(wid: string, rows: ImportContactRow[]): Promise<ActionResult<{ count: number }>> {
  const guard = await requireMember(wid);
  if (!guard.ok) return guard;
  if (!Array.isArray(rows) || rows.length === 0) return { ok: false, error: "추가할 연락처가 없습니다." };
  if (rows.length > CONTACT_LIMITS.importRows) {
    return { ok: false, error: `한 번에 최대 ${CONTACT_LIMITS.importRows}개까지 추가할 수 있습니다.` };
  }

  const inserts = [];
  for (const [i, r] of rows.entries()) {
    const email = String(r?.email ?? "");
    const phone = String(r?.phone ?? "");
    const { values, errors } = validateContact({
      name: String(r?.name ?? ""),
      phone,
      email,
      defaultChannel: email.trim() ? "email" : phone.trim() ? "phone" : null,
      description: "",
      company: String(r?.company ?? ""),
      position: "",
      businessNo: "",
    });
    if (!values) return { ok: false, error: `${i + 1}번째 연락처: ${firstError(errors)}` };
    inserts.push({ ...values, workspace_id: wid, owner_id: guard.userId });
  }

  const { error } = await guard.supabase.from("contacts").insert(inserts);
  if (error) return { ok: false, error: "연락처를 추가하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  revalidatePath(listPath(wid));
  return { ok: true, count: inserts.length };
}
