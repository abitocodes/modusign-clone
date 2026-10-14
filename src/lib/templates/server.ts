import "server-only";

import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { FIELD_ORDER } from "@/lib/fields";
import { BUCKET, paths } from "@/lib/storage";
import { createAdminClient } from "@/lib/supabase/admin";
import type { MemberRole, PageSize, TemplateField, TemplateRole, TemplateRow } from "@/lib/types";

import { sanitizeFieldOptions, type Result, type TemplateOption } from "./model";

/**
 * Server helpers of the 템플릿 / 대량전송 / 링크서명 area.
 * Callers authorise first; these helpers only do the work.
 */

export type TemplateForUse = Pick<
  TemplateRow,
  | "id"
  | "workspace_id"
  | "owner_id"
  | "title"
  | "file_path"
  | "page_count"
  | "page_sizes"
  | "request_type"
  | "signing_order"
  | "roles"
  | "fields"
  | "label_ids"
>;

export const TEMPLATE_USE_COLUMNS =
  "id, workspace_id, owner_id, title, file_path, page_count, page_sizes, request_type, signing_order, roles, fields, label_ids";

/** Role of the user in the workspace, or null when not a member. */
export async function memberRole(db: SupabaseClient, workspaceId: string, userId: string): Promise<MemberRole | null> {
  const { data } = await db
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();
  return ((data as { role: MemberRole } | null)?.role ?? null) as MemberRole | null;
}

export const canManageTemplate = (t: { owner_id: string }, userId: string, role: MemberRole | null) =>
  !!role && (t.owner_id === userId || role === "owner" || role === "admin");

/** Why a template cannot be used for one-person-per-document flows (대량전송 / 링크서명), or null. */
export function singleRoleTemplateIssue(t: TemplateForUse, purpose: "대량전송" | "링크서명"): string | null {
  const roles = (Array.isArray(t.roles) ? t.roles : []) as TemplateRole[];
  if (!t.file_path) return "템플릿 문서 파일이 없습니다.";
  if (roles.length !== 1) return `참여자 역할이 1개인 템플릿만 ${purpose}에 사용할 수 있습니다.`;
  const fields = (Array.isArray(t.fields) ? t.fields : []) as TemplateField[];
  if (t.request_type === "sign" && !fields.some((f) => f.role_key === roles[0].key)) return "서명 입력란이 배치되지 않은 템플릿입니다.";
  return null;
}

/** Templates the caller can see (RLS) as picker options for 대량전송 / 링크서명. */
export async function loadTemplateOptions(db: SupabaseClient, workspaceId: string): Promise<TemplateOption[]> {
  const { data, error } = await db
    .from("templates")
    .select("id, owner_id, title, request_type, roles, fields, page_count, updated_at")
    .eq("workspace_id", workspaceId)
    .not("file_path", "is", null)
    .order("updated_at", { ascending: false })
    .limit(500);
  if (error) throw new Error("템플릿 목록을 불러오지 못했습니다.");
  type Row = Pick<TemplateRow, "id" | "owner_id" | "title" | "request_type" | "roles" | "fields" | "page_count" | "updated_at">;
  const rows = (data ?? []) as Row[];
  const ownerIds = Array.from(new Set(rows.map((r) => r.owner_id)));
  const { data: people } = ownerIds.length ? await db.from("profiles").select("id, name").in("id", ownerIds) : { data: [] };
  const names = new Map(((people ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]));
  return rows.map((r) => {
    const roles = Array.isArray(r.roles) ? r.roles : [];
    const first = roles[0];
    const fields = Array.isArray(r.fields) ? r.fields : [];
    return {
      id: r.id,
      title: r.title,
      requestType: r.request_type,
      roleCount: roles.length,
      roleName: first?.name ?? "",
      fieldCount: first ? fields.filter((f) => f.role_key === first.key).length : 0,
      pageCount: r.page_count,
      updatedAt: r.updated_at,
      ownerName: names.get(r.owner_id) ?? null,
    };
  });
}

export interface InstantiateInput {
  /** client that writes the rows: the caller's RLS client, or the admin client for token flows */
  db: SupabaseClient;
  template: TemplateForUse;
  /** owner (requester) of the new document */
  ownerId: string;
  title?: string;
  labelIds?: string[];
  linkSignId?: string | null;
  /** one entry per role (role order). Omitted → empty participants (name "", e-mail null). */
  people?: { name: string; email: string | null }[];
}

export interface InstantiatedParticipant {
  id: string;
  accessToken: string;
  name: string;
  email: string | null;
}

/**
 * Creates a draft document from a template:
 *  - copies the template PDF to paths.documentOriginal (admin storage client)
 *  - document row (status draft, template_id, request type + signing order + labels copied)
 *  - one participant per role (delivery e-mail), fields mapped from role keys to participant ids
 * Everything is rolled back when a step fails.
 */
export async function instantiateTemplate(input: InstantiateInput): Promise<Result<{ documentId: string; participants: InstantiatedParticipant[] }>> {
  const { db, template: t } = input;
  if (!t.file_path) return { ok: false, error: "템플릿 문서 파일이 없습니다. 템플릿을 다시 저장해 주세요." };
  const roles = (Array.isArray(t.roles) ? t.roles : []) as TemplateRole[];
  if (roles.length === 0) return { ok: false, error: "템플릿에 참여자 역할이 없습니다." };

  const admin = createAdminClient();
  const documentId = randomUUID();
  const filePath = paths.documentOriginal(t.workspace_id, documentId);
  const title = (input.title ?? t.title).trim().slice(0, 100) || t.title;
  const sizes = (Array.isArray(t.page_sizes) ? t.page_sizes : []) as PageSize[];

  const { error: copyErr } = await admin.storage.from(BUCKET).copy(t.file_path, filePath);
  if (copyErr) return { ok: false, error: "템플릿 문서를 복사하지 못했습니다. 잠시 후 다시 시도해 주세요." };

  const rollback = async () => {
    await admin.from("documents").delete().eq("id", documentId);
    await admin.storage.from(BUCKET).remove([filePath]);
  };

  const now = new Date().toISOString();
  const doc: Record<string, unknown> = {
    id: documentId,
    workspace_id: t.workspace_id,
    owner_id: input.ownerId,
    template_id: t.id,
    title,
    status: "draft",
    request_type: t.request_type,
    signing_order: t.signing_order,
    file_name: `${title}.pdf`,
    file_path: filePath,
    page_count: Math.max(t.page_count || 1, sizes.length || 1),
    page_sizes: sizes,
    label_ids: input.labelIds ?? t.label_ids ?? [],
    last_activity_at: now,
  };
  if (input.linkSignId) doc.link_sign_id = input.linkSignId;

  // no `.select()`: RETURNING would be checked against documents_select before the row is visible
  const { error: docErr } = await db.from("documents").insert(doc);
  if (docErr) {
    await admin.storage.from(BUCKET).remove([filePath]);
    return { ok: false, error: "문서를 만들지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }

  const role = t.request_type === "view" ? "viewer" : "signer";
  const participants: InstantiatedParticipant[] = roles.map((_, i) => {
    const person = input.people?.[i];
    return {
      id: randomUUID(),
      accessToken: randomUUID(),
      name: (person?.name ?? "").trim().slice(0, 50),
      email: person?.email ? person.email.trim().toLowerCase() : null,
    };
  });
  const { error: partErr } = await db.from("participants").insert(
    participants.map((p, i) => ({
      id: p.id,
      document_id: documentId,
      order_index: i,
      role,
      name: p.name,
      email: p.email,
      delivery: "email",
      locale: "ko",
      status: "waiting",
      access_token: p.accessToken,
      role_label: roles[i]?.name?.trim() || null,
    })),
  );
  if (partErr) {
    await rollback();
    return { ok: false, error: "참여자 정보를 만들지 못했습니다." };
  }

  const byRole = new Map(roles.map((r, i) => [r.key, participants[i].id]));
  const maxPage = Math.max(sizes.length, t.page_count || 1);
  const fields = ((Array.isArray(t.fields) ? t.fields : []) as TemplateField[])
    .filter((f) => byRole.has(f.role_key) && FIELD_ORDER.includes(f.type) && Number.isInteger(f.page) && f.page >= 1 && f.page <= maxPage)
    .map((f) => ({
      id: randomUUID(),
      document_id: documentId,
      participant_id: byRole.get(f.role_key)!,
      type: f.type,
      page: f.page,
      x: Math.max(0, Number(f.x) || 0),
      y: Math.max(0, Number(f.y) || 0),
      width: Math.max(1, Number(f.width) || 1),
      height: Math.max(1, Number(f.height) || 1),
      required: f.type === "signed_date" ? true : f.required !== false,
      options: sanitizeFieldOptions(f.type, f.options),
    }));
  if (fields.length > 0) {
    const { error: fieldErr } = await db.from("fields").insert(fields);
    if (fieldErr) {
      await rollback();
      return { ok: false, error: "입력란 정보를 만들지 못했습니다." };
    }
  }

  return { ok: true, documentId, participants };
}

/** Deletes a draft created by instantiateTemplate that could not be sent (row + file). */
export async function discardInstantiated(db: SupabaseClient, workspaceId: string, documentId: string) {
  const { error } = await db.from("documents").delete().eq("id", documentId).eq("status", "draft");
  if (!error) await db.storage.from(BUCKET).remove([paths.documentOriginal(workspaceId, documentId)]);
}
