"use server";

import { revalidatePath } from "next/cache";

import { validateFields, type EditorField } from "@/components/editor/editor-model";
import { FIELD_ORDER } from "@/lib/fields";
import { paths } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import type { DocumentRow, FieldOptions, FieldType, MemberRole, PageSize, Participant, TemplateField, TemplateRole } from "@/lib/types";

type Result<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_FIELDS = 500;
const EDITABLE: DocumentRow["status"][] = ["draft", "on_modifying"];

type Supabase = Awaited<ReturnType<typeof createClient>>;
type DocForEdit = Pick<
  DocumentRow,
  "id" | "workspace_id" | "owner_id" | "title" | "status" | "request_type" | "signing_order" | "page_count" | "page_sizes" | "file_path" | "label_ids"
>;

/* ------------------------------------------------------------ validation */

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : undefined);
const r2 = (v: number) => Math.round(v * 100) / 100;

function sanitizeOptions(type: FieldType, raw: unknown): FieldOptions {
  const src = isObj(raw) ? raw : {};
  const o: FieldOptions = {};
  const label = str(src.label, 50)?.trim();
  if (label) o.label = label;

  if (type === "signature") {
    o.signMode = src.signMode === "sign" || src.signMode === "stamp" ? src.signMode : "any";
    if (src.drawOnly === true) o.drawOnly = true;
    if (src.uploadOnly === true) o.uploadOnly = true;
    if (src.resizable === true) o.resizable = true;
    if (src.batchSign === true) o.batchSign = true;
    return o;
  }
  if (type === "checkbox" || type === "image") return o;

  const fs = num(src.fontSize);
  if (fs !== null) o.fontSize = Math.min(20, Math.max(8, Math.round(fs)));
  const placeholder = str(src.placeholder, 100);
  if (placeholder?.trim()) o.placeholder = placeholder;

  if (type === "text") {
    if (src.format === "number" || src.format === "email" || src.format === "phone" || src.format === "free") o.format = src.format;
    if (src.autoFill === "name" || src.autoFill === "company" || src.autoFill === "address") o.autoFill = src.autoFill;
    const defaultText = str(src.defaultText, 500);
    if (defaultText) o.defaultText = defaultText;
  }
  if (type === "dropdown") {
    o.items = (Array.isArray(src.items) ? src.items : [])
      .filter((s): s is string => typeof s === "string")
      .map((s) => s.trim().slice(0, 100))
      .filter(Boolean)
      .slice(0, 50);
  }
  if (type === "transcribe") o.sentence = str(src.sentence, 200)?.trim() ?? "";
  return o;
}

/** Validates and normalises the editor payload (geometry clamped to the page). */
function parseFields(raw: unknown, sizes: PageSize[], maxPage: number): Result<{ fields: EditorField[] }> {
  if (!Array.isArray(raw)) return { ok: false, error: "입력란 정보가 올바르지 않습니다." };
  if (raw.length > MAX_FIELDS) return { ok: false, error: `입력란은 최대 ${MAX_FIELDS}개까지 배치할 수 있습니다.` };
  const seen = new Set<string>();
  const out: EditorField[] = [];
  for (const item of raw) {
    if (!isObj(item)) return { ok: false, error: "입력란 정보가 올바르지 않습니다." };
    const type = item.type as FieldType;
    if (!FIELD_ORDER.includes(type)) return { ok: false, error: "알 수 없는 입력란 유형입니다." };
    const participantKey = typeof item.participantKey === "string" ? item.participantKey : "";
    const page = num(item.page);
    const x = num(item.x);
    const y = num(item.y);
    const width = num(item.width);
    const height = num(item.height);
    if (page === null || !Number.isInteger(page) || page < 1 || page > maxPage || x === null || y === null || width === null || height === null) {
      return { ok: false, error: "입력란의 위치 정보가 올바르지 않습니다." };
    }
    if (width <= 0 || height <= 0) return { ok: false, error: "입력란의 크기가 올바르지 않습니다." };
    const size = sizes[page - 1];
    const w = size ? Math.min(width, size.w) : width;
    const h = size ? Math.min(height, size.h) : height;
    const cx = size ? Math.min(Math.max(x, 0), size.w - w) : Math.max(x, 0);
    const cy = size ? Math.min(Math.max(y, 0), size.h - h) : Math.max(y, 0);
    let id = typeof item.id === "string" && UUID_RE.test(item.id) ? item.id.toLowerCase() : crypto.randomUUID();
    if (seen.has(id)) id = crypto.randomUUID();
    seen.add(id);
    out.push({
      id,
      participantKey,
      type,
      page,
      x: r2(cx),
      y: r2(cy),
      width: r2(w),
      height: r2(h),
      required: type === "signed_date" ? true : item.required !== false,
      options: sanitizeOptions(type, item.options),
    });
  }
  return { ok: true, fields: out };
}

/* --------------------------------------------------------- authorisation */

async function authorize(supabase: Supabase, workspaceId: string, documentId: string): Promise<Result<{ userId: string; doc: DocForEdit }>> {
  if (!UUID_RE.test(workspaceId) || !UUID_RE.test(documentId)) return { ok: false, error: "잘못된 요청입니다." };
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다." };

  const { data: member } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member) return { ok: false, error: "이 워크스페이스에 접근할 권한이 없습니다." };

  const { data: doc } = await supabase
    .from("documents")
    .select("id, workspace_id, owner_id, title, status, request_type, signing_order, page_count, page_sizes, file_path, label_ids")
    .eq("id", documentId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!doc) return { ok: false, error: "문서를 찾을 수 없습니다." };

  const d = doc as DocForEdit;
  const role = (member as { role: MemberRole }).role;
  if (d.owner_id !== user.id && role === "member") return { ok: false, error: "이 문서를 편집할 권한이 없습니다." };
  if (!EDITABLE.includes(d.status)) return { ok: false, error: "이미 전송된 문서는 편집할 수 없습니다." };
  return { ok: true, userId: user.id, doc: d };
}

function revalidateDocument(workspaceId: string, documentId: string) {
  revalidatePath(`/workspaces/${workspaceId}/documents/d/${documentId}/steps/2`);
  revalidatePath(`/workspaces/${workspaceId}/documents/d/${documentId}/steps/3`);
  revalidatePath(`/workspaces/${workspaceId}/esign/documents/documents`);
}

/* --------------------------------------------------------------- actions */

export interface SaveFieldsInput {
  workspaceId: string;
  documentId: string;
  /** "draft" = 임시 저장 / 이전 (no completeness check), "next" = 다음으로 (validates) */
  mode: "draft" | "next";
  fields: EditorField[];
}

/** Replaces all fields of the document (participantKey = participant id). Status stays draft / on_modifying. */
export async function saveDocumentFields(input: SaveFieldsInput): Promise<Result<{ count: number }>> {
  const supabase = await createClient();
  const auth = await authorize(supabase, input?.workspaceId, input?.documentId);
  if (!auth.ok) return auth;
  const { doc } = auth;

  const sizes = Array.isArray(doc.page_sizes) ? doc.page_sizes : [];
  const parsed = parseFields(input.fields, sizes, Math.max(doc.page_count || 1, sizes.length));
  if (!parsed.ok) return parsed;

  const { data: parts, error: pErr } = await supabase
    .from("participants")
    .select("id, role, order_index")
    .eq("document_id", doc.id)
    .order("order_index");
  if (pErr) return { ok: false, error: "참여자 정보를 불러오지 못했습니다." };
  const participants = (parts ?? []) as Pick<Participant, "id" | "role" | "order_index">[];
  const ids = new Set(participants.map((p) => p.id));
  if (parsed.fields.some((f) => !ids.has(f.participantKey))) {
    return { ok: false, error: "참여자 정보가 변경되었습니다. 페이지를 새로고침해 주세요." };
  }

  if (input.mode === "next") {
    const signerKeys = participants.filter((p) => p.role !== "viewer").map((p) => p.id);
    const msg = validateFields(parsed.fields, signerKeys, { requireEverySigner: doc.request_type === "sign" });
    if (msg) return { ok: false, error: msg };
  }

  const payload = (fields: EditorField[]) =>
    fields.map((f) => ({
      id: f.id,
      participant_id: f.participantKey,
      type: f.type,
      page: f.page,
      x: f.x,
      y: f.y,
      width: f.width,
      height: f.height,
      required: f.required,
      options: f.options,
    }));

  let { error } = await supabase.rpc("replace_document_fields", { p_document_id: doc.id, p_fields: payload(parsed.fields) });
  if (error?.code === "23505") {
    // an id collided with a field of another document → retry with fresh ids
    ({ error } = await supabase.rpc("replace_document_fields", {
      p_document_id: doc.id,
      p_fields: payload(parsed.fields.map((f) => ({ ...f, id: crypto.randomUUID() }))),
    }));
  }
  if (error) {
    if (error.code === "55000") return { ok: false, error: "이미 전송된 문서는 편집할 수 없습니다." };
    return { ok: false, error: "입력란을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }

  revalidateDocument(doc.workspace_id, doc.id);
  return { ok: true, count: parsed.fields.length };
}

export interface SaveAsTemplateInput {
  workspaceId: string;
  documentId: string;
  fields: EditorField[];
}

/** 템플릿으로 저장: copies the PDF + participants (as roles) + current fields into a new template. */
export async function saveDocumentAsTemplate(input: SaveAsTemplateInput): Promise<Result<{ templateId: string }>> {
  const supabase = await createClient();
  const auth = await authorize(supabase, input?.workspaceId, input?.documentId);
  if (!auth.ok) return auth;
  const { doc, userId } = auth;
  if (!doc.file_path) return { ok: false, error: "문서 파일이 없습니다." };

  const sizes = Array.isArray(doc.page_sizes) ? doc.page_sizes : [];
  const parsed = parseFields(input.fields, sizes, Math.max(doc.page_count || 1, sizes.length));
  if (!parsed.ok) return parsed;

  const { data: parts } = await supabase.from("participants").select("id, order_index").eq("document_id", doc.id).order("order_index");
  const participants = (parts ?? []) as Pick<Participant, "id" | "order_index">[];
  // generic role names (like step 1's 템플릿으로 저장): a reusable template must not carry this request's people
  const who = doc.request_type === "view" ? "열람자" : "서명자";
  const roles: TemplateRole[] = participants.map((p, i) => ({ key: `role_${i + 1}`, name: `${who} ${i + 1}`, color_index: i }));
  const roleOf = new Map(participants.map((p, i) => [p.id, roles[i].key]));
  if (parsed.fields.some((f) => !roleOf.has(f.participantKey))) {
    return { ok: false, error: "참여자 정보가 변경되었습니다. 페이지를 새로고침해 주세요." };
  }
  const fields: TemplateField[] = parsed.fields.map((f) => ({
    role_key: roleOf.get(f.participantKey)!,
    type: f.type,
    page: f.page,
    x: f.x,
    y: f.y,
    width: f.width,
    height: f.height,
    required: f.required,
    options: f.options,
  }));

  const templateId = crypto.randomUUID();
  const filePath = paths.template(doc.workspace_id, templateId);
  const { error: copyErr } = await supabase.storage.from("documents").copy(doc.file_path, filePath);
  if (copyErr) return { ok: false, error: "문서 파일을 복사하지 못했습니다." };

  const { error } = await supabase.from("templates").insert({
    id: templateId,
    workspace_id: doc.workspace_id,
    owner_id: userId,
    title: doc.title,
    file_path: filePath,
    page_count: doc.page_count,
    page_sizes: sizes,
    request_type: doc.request_type,
    signing_order: doc.signing_order,
    roles,
    fields,
    label_ids: doc.label_ids ?? [],
    last_modified_by: userId,
  });
  if (error) {
    await supabase.storage.from("documents").remove([filePath]);
    return { ok: false, error: "템플릿을 저장하지 못했습니다." };
  }

  revalidatePath(`/workspaces/${doc.workspace_id}/esign/requests/templates`);
  return { ok: true, templateId };
}
