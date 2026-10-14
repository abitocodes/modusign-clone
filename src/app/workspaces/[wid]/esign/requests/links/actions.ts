"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { appUrl } from "@/lib/email/mailer";
import { createClient } from "@/lib/supabase/server";
import { LINK_TITLE_MAX, MAX_LABELS, isUuid, type Result } from "@/lib/templates/model";
import { TEMPLATE_USE_COLUMNS, canManageTemplate, memberRole, singleRoleTemplateIssue, type TemplateForUse } from "@/lib/templates/server";
import type { LinkSign, MemberRole } from "@/lib/types";

type Supabase = Awaited<ReturnType<typeof createClient>>;
type Auth = { ok: true; supabase: Supabase; userId: string; role: MemberRole } | { ok: false; error: string };

async function authorize(wid: unknown): Promise<Auth> {
  if (!isUuid(wid)) return { ok: false, error: "잘못된 요청입니다." };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다. 다시 로그인해 주세요." };
  const role = await memberRole(supabase, wid, user.id);
  if (!role) return { ok: false, error: "이 워크스페이스에 접근할 권한이 없습니다." };
  return { ok: true, supabase, userId: user.id, role };
}

const linkPath = (wid: string) => `/workspaces/${wid}/esign/requests/links`;

export interface CreateLinkInput {
  templateId: string;
  title: string;
  labelIds: string[];
}

/** 링크서명 시작: creates an active public link for a single-role template. */
export async function createLinkSign(wid: string, input: CreateLinkInput): Promise<Result<{ id: string; url: string }>> {
  const auth = await authorize(wid);
  if (!auth.ok) return auth;
  if (!input || !isUuid(input.templateId)) return { ok: false, error: "템플릿을 선택해 주세요." };
  const title = typeof input.title === "string" ? input.title.trim().replace(/\s+/g, " ") : "";
  if (!title) return { ok: false, error: "링크 제목을 입력해 주세요." };
  if (title.length > LINK_TITLE_MAX) return { ok: false, error: `링크 제목은 ${LINK_TITLE_MAX}자 이내로 입력해 주세요.` };

  const { data } = await auth.supabase.from("templates").select(TEMPLATE_USE_COLUMNS).eq("id", input.templateId).eq("workspace_id", wid).maybeSingle();
  const template = data as TemplateForUse | null;
  if (!template) return { ok: false, error: "템플릿을 찾을 수 없거나 사용할 권한이 없습니다." };
  const issue = singleRoleTemplateIssue(template, "링크서명");
  if (issue) return { ok: false, error: issue };

  const wanted = Array.isArray(input.labelIds) ? Array.from(new Set(input.labelIds.filter(isUuid))).slice(0, MAX_LABELS) : [];
  let labelIds: string[] = [];
  if (wanted.length) {
    const { data: labels } = await auth.supabase.from("labels").select("id").eq("workspace_id", wid).in("id", wanted);
    const ok = new Set(((labels ?? []) as { id: string }[]).map((l) => l.id));
    labelIds = wanted.filter((id) => ok.has(id));
  }

  const id = randomUUID();
  const token = randomUUID();
  const { error } = await auth.supabase.from("link_signs").insert({
    id,
    workspace_id: wid,
    owner_id: auth.userId,
    template_id: template.id,
    title,
    token,
    active: true,
    label_ids: labelIds,
  });
  if (error) return { ok: false, error: "링크서명을 만들지 못했습니다. 잠시 후 다시 시도해 주세요." };
  revalidatePath(linkPath(wid));
  revalidatePath(`/workspaces/${wid}/esign/requests/templates`);
  return { ok: true, id, url: appUrl(`/link/${token}`) };
}

async function loadManageable(auth: Extract<Auth, { ok: true }>, wid: string, id: unknown) {
  if (!isUuid(id)) return { ok: false as const, error: "잘못된 요청입니다." };
  const { data } = await auth.supabase.from("link_signs").select("id, owner_id").eq("id", id).eq("workspace_id", wid).maybeSingle();
  const link = data as Pick<LinkSign, "id" | "owner_id"> | null;
  if (!link) return { ok: false as const, error: "링크서명을 찾을 수 없습니다." };
  if (!canManageTemplate(link, auth.userId, auth.role)) return { ok: false as const, error: "링크서명을 만든 멤버나 관리자만 변경할 수 있습니다." };
  return { ok: true as const, link };
}

/** 활성 / 비활성 */
export async function setLinkActive(wid: string, id: string, active: boolean): Promise<Result> {
  const auth = await authorize(wid);
  if (!auth.ok) return auth;
  const res = await loadManageable(auth, wid, id);
  if (!res.ok) return res;
  const { error } = await auth.supabase.from("link_signs").update({ active: !!active }).eq("id", res.link.id);
  if (error) return { ok: false, error: "링크서명 상태를 바꾸지 못했습니다." };
  revalidatePath(linkPath(wid));
  revalidatePath(`/workspaces/${wid}/esign/requests/templates`);
  return { ok: true };
}

/** 삭제 — the public link stops working; documents already signed through it are kept. */
export async function deleteLinkSign(wid: string, id: string): Promise<Result> {
  const auth = await authorize(wid);
  if (!auth.ok) return auth;
  const res = await loadManageable(auth, wid, id);
  if (!res.ok) return res;
  const { error } = await auth.supabase.from("link_signs").delete().eq("id", res.link.id);
  if (error) return { ok: false, error: "링크서명을 삭제하지 못했습니다." };
  revalidatePath(linkPath(wid));
  revalidatePath(`/workspaces/${wid}/esign/requests/templates`);
  return { ok: true };
}
