"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import type { MemberRole, SignatureKind } from "@/lib/types";

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PNG_DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/;
/** ~3 MB of PNG — generated signatures/stamps are far smaller (trimmed, ≤ 1060px) */
const MAX_IMAGE_CHARS = 4_000_000;
const MAX_NAME_LENGTH = 30;

const KIND_LABEL: Record<SignatureKind, string> = { sign: "사인", stamp: "도장" };

const pagePath = (wid: string) => `/workspaces/${wid}/esign/requests/signatures`;
/** my rows that belong to this workspace (or to no workspace) */
const scopeFilter = (wid: string) => `workspace_id.eq.${wid},workspace_id.is.null`;

async function authorise(wid: string) {
  if (!UUID.test(wid)) return { error: "잘못된 요청입니다." } as const;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "로그인이 필요합니다." } as const;
  const { data: member } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", wid)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member) return { error: "이 워크스페이스에 접근할 수 없습니다." } as const;
  return { supabase, userId: user.id, role: member.role as MemberRole } as const;
}

async function loadOwn(supabase: Awaited<ReturnType<typeof createClient>>, userId: string, wid: string, id: string) {
  if (!UUID.test(id)) return null;
  const { data } = await supabase
    .from("signatures")
    .select("id, kind, workspace_id, is_default, shared")
    .eq("id", id)
    .eq("user_id", userId)
    .or(scopeFilter(wid))
    .maybeSingle();
  return data as { id: string; kind: SignatureKind; workspace_id: string | null; is_default: boolean; shared: boolean } | null;
}

/** Registers a signature / stamp. The first one of each kind becomes the default. */
export async function createSignature(
  wid: string,
  input: { kind: SignatureKind; imageData: string; name?: string },
): Promise<ActionResult<{ id: string }>> {
  const auth = await authorise(wid);
  if ("error" in auth) return { ok: false, error: auth.error ?? "권한이 없습니다." };
  const { supabase, userId } = auth;

  const kind = input?.kind;
  if (kind !== "sign" && kind !== "stamp") return { ok: false, error: "잘못된 종류입니다." };
  const image = typeof input.imageData === "string" ? input.imageData : "";
  if (!PNG_DATA_URL.test(image)) return { ok: false, error: "이미지 형식이 올바르지 않습니다." };
  if (image.length > MAX_IMAGE_CHARS) return { ok: false, error: "이미지 용량이 너무 큽니다. 더 작은 이미지를 사용해 주세요." };

  const { data: existing, error: listError } = await supabase
    .from("signatures")
    .select("id, is_default")
    .eq("user_id", userId)
    .eq("kind", kind)
    .or(scopeFilter(wid));
  if (listError) return { ok: false, error: "등록하지 못했습니다. 잠시 후 다시 시도해 주세요." };

  const rows = existing ?? [];
  let name = (input.name ?? "").trim().slice(0, MAX_NAME_LENGTH);
  if (!name) name = `${KIND_LABEL[kind]} ${rows.length + 1}`;

  const { data, error } = await supabase
    .from("signatures")
    .insert({
      user_id: userId,
      workspace_id: wid,
      kind,
      name,
      image_data: image,
      is_default: !rows.some((r) => r.is_default),
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "등록하지 못했습니다. 잠시 후 다시 시도해 주세요." };

  revalidatePath(pagePath(wid));
  return { ok: true, data: { id: data.id as string } };
}

export async function setDefaultSignature(wid: string, id: string): Promise<ActionResult> {
  const auth = await authorise(wid);
  if ("error" in auth) return { ok: false, error: auth.error ?? "권한이 없습니다." };
  const { supabase, userId } = auth;
  const row = await loadOwn(supabase, userId, wid, id);
  if (!row) return { ok: false, error: "사인·도장을 찾을 수 없습니다." };
  if (row.is_default) return { ok: true };

  const { error: clearError } = await supabase
    .from("signatures")
    .update({ is_default: false })
    .eq("user_id", userId)
    .eq("kind", row.kind)
    .eq("is_default", true)
    .or(scopeFilter(wid));
  if (clearError) return { ok: false, error: "기본으로 설정하지 못했습니다." };
  const { error } = await supabase.from("signatures").update({ is_default: true }).eq("id", row.id).eq("user_id", userId);
  if (error) return { ok: false, error: "기본으로 설정하지 못했습니다." };

  revalidatePath(pagePath(wid));
  return { ok: true };
}

export async function renameSignature(wid: string, id: string, name: string): Promise<ActionResult> {
  const auth = await authorise(wid);
  if ("error" in auth) return { ok: false, error: auth.error ?? "권한이 없습니다." };
  const { supabase, userId } = auth;
  const value = typeof name === "string" ? name.trim() : "";
  if (!value) return { ok: false, error: "이름을 입력해 주세요." };
  if (value.length > MAX_NAME_LENGTH) return { ok: false, error: `이름은 ${MAX_NAME_LENGTH}자까지 입력할 수 있습니다.` };
  const row = await loadOwn(supabase, userId, wid, id);
  if (!row) return { ok: false, error: "사인·도장을 찾을 수 없습니다." };

  const { error } = await supabase.from("signatures").update({ name: value }).eq("id", row.id).eq("user_id", userId);
  if (error) return { ok: false, error: "이름을 변경하지 못했습니다." };

  revalidatePath(pagePath(wid));
  return { ok: true };
}

/** Deletes a signature / stamp; when it was the default, the newest remaining one of the same kind takes over. */
export async function deleteSignature(wid: string, id: string): Promise<ActionResult> {
  const auth = await authorise(wid);
  if ("error" in auth) return { ok: false, error: auth.error ?? "권한이 없습니다." };
  const { supabase, userId } = auth;
  const row = await loadOwn(supabase, userId, wid, id);
  if (!row) return { ok: false, error: "사인·도장을 찾을 수 없습니다." };

  const { error } = await supabase.from("signatures").delete().eq("id", row.id).eq("user_id", userId);
  if (error) return { ok: false, error: "삭제하지 못했습니다." };

  if (row.is_default) {
    const { data: next } = await supabase
      .from("signatures")
      .select("id")
      .eq("user_id", userId)
      .eq("kind", row.kind)
      .or(scopeFilter(wid))
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (next) await supabase.from("signatures").update({ is_default: true }).eq("id", next.id).eq("user_id", userId);
  }

  revalidatePath(pagePath(wid));
  return { ok: true };
}

/** Admins can share their stamps (e.g. 법인 도장) with every member of the workspace. */
export async function setSignatureShared(wid: string, id: string, shared: boolean): Promise<ActionResult> {
  const auth = await authorise(wid);
  if ("error" in auth) return { ok: false, error: auth.error ?? "권한이 없습니다." };
  const { supabase, userId, role } = auth;
  if (role !== "owner" && role !== "admin") return { ok: false, error: "관리자만 도장을 공유할 수 있습니다." };
  const row = await loadOwn(supabase, userId, wid, id);
  if (!row) return { ok: false, error: "도장을 찾을 수 없습니다." };
  if (row.kind !== "stamp") return { ok: false, error: "도장만 공유할 수 있습니다." };

  const { error } = await supabase
    .from("signatures")
    .update({ shared: !!shared, workspace_id: wid })
    .eq("id", row.id)
    .eq("user_id", userId);
  if (error) return { ok: false, error: "공유 설정을 변경하지 못했습니다." };

  revalidatePath(pagePath(wid));
  return { ok: true };
}
