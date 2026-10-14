/**
 * Client-safe model + validation helpers of the 템플릿 / 대량전송 / 링크서명 area.
 * Used by the browser (instant feedback) and by the Server Actions (authoritative checks).
 */
import { validateFields, type EditorField } from "@/components/editor/editor-model";
import { EMAIL_RE, isValidEmail } from "@/lib/email/address";
import { parseDelimited } from "@/lib/tools/contacts";
import { FIELD_ORDER } from "@/lib/fields";
import type { FieldOptions, FieldType, PageSize, RequestType, SigningOrder, TemplateField, TemplateRole } from "@/lib/types";

export type Result<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };

export const TEMPLATE_TITLE_MAX = 100;
export const ROLE_NAME_MAX = 30;
export const MAX_ROLES = 30;
export const MAX_TEMPLATE_FIELDS = 500;
export const MAX_TEMPLATE_PAGES = 500;
export const MAX_LABELS = 50;
export const BULK_MAX_RECIPIENTS = 300;
export const BULK_TITLE_MAX = 100;
export const LINK_TITLE_MAX = 100;
export const PERSON_NAME_MAX = 50;

// linear-time pattern (see @/lib/email/address); isValidEmail checks the length first
export { EMAIL_RE, isValidEmail };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLE_KEY_RE = /^[A-Za-z0-9_-]{1,64}$/;

export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

/* ------------------------------------------------------------------ roles */

export const whoLabel = (t: RequestType) => (t === "view" ? "열람자" : "서명자");
export const defaultRoleName = (t: RequestType, index: number) => `${whoLabel(t)} ${index + 1}`;
/** "서명자 3" / "열람자 1" — names that follow the position and may be renumbered automatically. */
export const isDefaultRoleName = (name: string) => /^(서명자|열람자) \d{1,2}$/.test(name.trim());

/** A role as edited in the template editor (color = position, like the wizard). */
export interface RoleDraft {
  key: string;
  name: string;
}

/* ------------------------------------------------------------ validation */

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : undefined);
const r2 = (v: number) => Math.round(v * 100) / 100;

export function validPageSize(s: unknown): s is PageSize {
  if (!isObj(s)) return false;
  const w = num(s.w);
  const h = num(s.h);
  return w !== null && h !== null && w > 0 && h > 0 && w <= 14400 && h <= 14400;
}

/** Same option rules as the wizard's field editor (step 2). */
export function sanitizeFieldOptions(type: FieldType, raw: unknown): FieldOptions {
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

/** Validates roles: 1–30, unique keys and names, 1–30 characters. */
export function parseRoles(raw: unknown): Result<{ roles: RoleDraft[] }> {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: "역할을 1개 이상 추가해 주세요." };
  if (raw.length > MAX_ROLES) return { ok: false, error: `역할은 최대 ${MAX_ROLES}개까지 만들 수 있습니다.` };
  const keys = new Set<string>();
  const names = new Set<string>();
  const roles: RoleDraft[] = [];
  for (const r of raw) {
    if (!isObj(r) || typeof r.key !== "string" || !ROLE_KEY_RE.test(r.key)) return { ok: false, error: "역할 정보가 올바르지 않습니다." };
    const name = typeof r.name === "string" ? r.name.trim().replace(/\s+/g, " ") : "";
    if (!name) return { ok: false, error: "역할 이름을 입력해 주세요." };
    if (name.length > ROLE_NAME_MAX) return { ok: false, error: `역할 이름은 ${ROLE_NAME_MAX}자 이내로 입력해 주세요.` };
    if (keys.has(r.key)) return { ok: false, error: "역할 정보가 올바르지 않습니다." };
    const lower = name.toLowerCase();
    if (names.has(lower)) return { ok: false, error: `같은 이름의 역할(${name})이 있습니다.` };
    keys.add(r.key);
    names.add(lower);
    roles.push({ key: r.key, name });
  }
  return { ok: true, roles };
}

/** Editor fields (participantKey = role key) → stored template fields, geometry clamped to the page. */
export function parseTemplateFields(raw: unknown, roleKeys: string[], sizes: PageSize[]): Result<{ fields: TemplateField[] }> {
  if (!Array.isArray(raw)) return { ok: false, error: "입력란 정보가 올바르지 않습니다." };
  if (raw.length > MAX_TEMPLATE_FIELDS) return { ok: false, error: `입력란은 최대 ${MAX_TEMPLATE_FIELDS}개까지 배치할 수 있습니다.` };
  const keys = new Set(roleKeys);
  const out: TemplateField[] = [];
  for (const item of raw) {
    if (!isObj(item)) return { ok: false, error: "입력란 정보가 올바르지 않습니다." };
    const type = item.type as FieldType;
    if (!FIELD_ORDER.includes(type)) return { ok: false, error: "알 수 없는 입력란 유형입니다." };
    const roleKey = typeof item.participantKey === "string" ? item.participantKey : "";
    if (!keys.has(roleKey)) return { ok: false, error: "역할이 지정되지 않은 입력란이 있습니다." };
    const page = num(item.page);
    const x = num(item.x);
    const y = num(item.y);
    const width = num(item.width);
    const height = num(item.height);
    if (page === null || !Number.isInteger(page) || page < 1 || page > sizes.length || x === null || y === null || width === null || height === null) {
      return { ok: false, error: "입력란의 위치 정보가 올바르지 않습니다." };
    }
    if (width <= 0 || height <= 0) return { ok: false, error: "입력란의 크기가 올바르지 않습니다." };
    const size = sizes[page - 1];
    const w = Math.min(width, size.w);
    const h = Math.min(height, size.h);
    out.push({
      role_key: roleKey,
      type,
      page,
      x: r2(Math.min(Math.max(x, 0), size.w - w)),
      y: r2(Math.min(Math.max(y, 0), size.h - h)),
      width: r2(w),
      height: r2(h),
      required: type === "signed_date" ? true : item.required !== false,
      options: sanitizeFieldOptions(type, item.options),
    });
  }
  return { ok: true, fields: out };
}

/** Completeness rules shared by the editor (다음으로) and the save action. */
export function templateFieldsError(fields: EditorField[], roles: RoleDraft[], requestType: RequestType): string | null {
  return validateFields(
    fields,
    roles.map((r) => r.key),
    { requireEverySigner: requestType === "sign" },
  );
}

/** Stored template fields → editor fields (ids are generated per editing session). */
export function toEditorFields(fields: TemplateField[], roleKeys: Set<string>, makeId: () => string): EditorField[] {
  return (Array.isArray(fields) ? fields : [])
    .filter((f) => roleKeys.has(f.role_key))
    .map((f) => ({
      id: makeId(),
      participantKey: f.role_key,
      type: f.type,
      page: f.page,
      x: f.x,
      y: f.y,
      width: f.width,
      height: f.height,
      required: f.required,
      options: f.options ?? {},
    }));
}

/** Payload sent by the template editor when saving. */
export interface TemplatePayload {
  title: string;
  requestType: RequestType;
  signingOrder: SigningOrder;
  roles: RoleDraft[];
  fields: EditorField[];
  labelIds: string[];
  shared: boolean;
  pageSizes: PageSize[];
}

export interface CleanTemplate {
  title: string;
  request_type: RequestType;
  signing_order: SigningOrder;
  roles: TemplateRole[];
  fields: TemplateField[];
  label_ids: string[];
  shared: boolean;
  page_count: number;
  page_sizes: PageSize[];
}

/** Full validation of an editor payload (server side). `sizes` overrides the payload's page sizes. */
export function cleanTemplatePayload(input: TemplatePayload, sizesOverride?: PageSize[]): Result<{ value: CleanTemplate }> {
  if (!isObj(input)) return { ok: false, error: "잘못된 요청입니다." };
  const title = typeof input.title === "string" ? input.title.trim().replace(/\s+/g, " ") : "";
  if (!title) return { ok: false, error: "템플릿 제목을 입력해 주세요." };
  if (title.length > TEMPLATE_TITLE_MAX) return { ok: false, error: `템플릿 제목은 ${TEMPLATE_TITLE_MAX}자 이내로 입력해 주세요.` };
  const requestType: RequestType = input.requestType === "view" ? "view" : "sign";
  const signingOrder: SigningOrder = input.signingOrder === "parallel" ? "parallel" : "sequential";

  const sizes = sizesOverride ?? input.pageSizes;
  if (!Array.isArray(sizes) || sizes.length < 1 || sizes.length > MAX_TEMPLATE_PAGES || !sizes.every(validPageSize)) {
    return { ok: false, error: "문서의 페이지 정보를 읽지 못했습니다." };
  }
  const pageSizes = sizes.map((s) => ({ w: r2(s.w), h: r2(s.h) }));

  const roles = parseRoles(input.roles);
  if (!roles.ok) return roles;
  const parsed = parseTemplateFields(input.fields, roles.roles.map((r) => r.key), pageSizes);
  if (!parsed.ok) return parsed;

  const asEditor: EditorField[] = parsed.fields.map((f, i) => ({ ...f, id: String(i), participantKey: f.role_key }));
  const missing = templateFieldsError(asEditor, roles.roles, requestType);
  if (missing) return { ok: false, error: missing };

  const labelIds = Array.isArray(input.labelIds) ? Array.from(new Set(input.labelIds.filter(isUuid))).slice(0, MAX_LABELS) : [];

  return {
    ok: true,
    value: {
      title,
      request_type: requestType,
      signing_order: signingOrder,
      roles: roles.roles.map((r, i) => ({ key: r.key, name: r.name, color_index: i })),
      fields: parsed.fields,
      label_ids: labelIds,
      shared: input.shared === true,
      page_count: pageSizes.length,
      page_sizes: pageSizes,
    },
  };
}

/* ------------------------------------------------------- template picker */

/** Template summary for the 대량전송 / 링크서명 pickers. */
export interface TemplateOption {
  id: string;
  title: string;
  requestType: RequestType;
  roleCount: number;
  /** name of the first role */
  roleName: string;
  /** fields of the first role */
  fieldCount: number;
  pageCount: number;
  updatedAt: string;
  ownerName: string | null;
}

/** Why a template cannot be used for a single-recipient flow (대량전송 / 링크서명), or null. */
export function singleRoleIssue(t: Pick<TemplateOption, "roleCount" | "fieldCount" | "requestType">): string | null {
  if (t.roleCount !== 1) return `참여자 역할이 1개인 템플릿만 사용할 수 있습니다. (현재 ${t.roleCount}개)`;
  if (t.requestType === "sign" && t.fieldCount === 0) return "서명 입력란이 배치되지 않은 템플릿입니다.";
  return null;
}

/* ------------------------------------------------------------ recipients */

export interface RecipientInput {
  name: string;
  email: string;
}

export interface RecipientRow extends RecipientInput {
  /** row number in the source (1-based) */
  line: number;
  error: string | null;
}

const HEADER_WORDS = ["이름", "name", "성명", "성함", "수신자"];
const EMAIL_TOKEN_RE = /[^\s,;<>"']+@[^\s,;<>"']+/;

/**
 * A row that was not split by the file's delimiter (e.g. tab- or semicolon-separated lines in a
 * comma file, or "홍길동 hong@example.com" typed by hand) → [name, email].
 */
function splitLooseRow(cells: string[]): string[] {
  if (cells.length !== 1) return cells;
  const line = cells[0];
  const byDelim = line.split(/[\t;,]/).map((c) => c.trim()).filter(Boolean);
  if (byDelim.length >= 2) return byDelim;
  const m = EMAIL_TOKEN_RE.exec(line);
  if (!m) return cells;
  const name = (line.slice(0, m.index) + " " + line.slice(m.index + m[0].length)).replace(/[<>()"']/g, " ").trim();
  return [name, m[0]];
}

/** CSV / pasted spreadsheet rows (이름, 이메일) → recipients. A header row is skipped. */
export function parseRecipientsText(text: string): RecipientInput[] {
  const rows = parseDelimited(text);
  const out: RecipientInput[] = [];
  rows.forEach((raw, i) => {
    const cells = splitLooseRow(raw);
    let [name = "", email = ""] = cells;
    if (i === 0 && HEADER_WORDS.includes(name.trim().toLowerCase())) return;
    // tolerate "이메일, 이름" order
    if (isValidEmail(name.trim()) && !isValidEmail(email.trim())) [name, email] = [email, name];
    out.push({ name: name.trim(), email: email.trim() });
  });
  return out;
}

/** Validates every recipient (name, e-mail format, duplicate e-mails). */
export function validateRecipients(list: RecipientInput[]): RecipientRow[] {
  const counts = new Map<string, number>();
  for (const r of list) {
    const e = r.email.trim().toLowerCase();
    if (e) counts.set(e, (counts.get(e) ?? 0) + 1);
  }
  return list.map((r, i) => {
    const name = r.name.trim();
    const email = r.email.trim().toLowerCase();
    let error: string | null = null;
    if (!name) error = "이름을 입력해 주세요.";
    else if (name.length > PERSON_NAME_MAX) error = `이름은 ${PERSON_NAME_MAX}자 이내로 입력해 주세요.`;
    else if (!email) error = "이메일을 입력해 주세요.";
    else if (!isValidEmail(email)) error = "이메일 형식이 올바르지 않습니다.";
    else if ((counts.get(email) ?? 0) > 1) error = "중복된 이메일입니다.";
    return { line: i + 1, name: r.name, email: r.email, error };
  });
}

export const RECIPIENTS_CSV_TEMPLATE = "﻿이름,이메일\r\n홍길동,hong@example.com\r\n김예시,kim@example.com\r\n";

/** recipients jsonb item of public.bulk_sends */
export interface BulkRecipientItem {
  name: string;
  email: string;
  status: "pending" | "processing" | "sent" | "failed";
  document_id: string | null;
  error: string | null;
  processed_at?: string | null;
}

export interface BulkSummary {
  status: "pending" | "sending" | "sent" | "failed";
  total: number;
  sent: number;
  failed: number;
  pending: number;
  processing: number;
}

export const BULK_STATUS_LABEL: Record<BulkSummary["status"], string> = {
  pending: "전송 대기",
  sending: "전송 중",
  sent: "전송 완료",
  failed: "전송 실패",
};
