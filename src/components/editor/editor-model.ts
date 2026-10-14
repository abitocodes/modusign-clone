import { FIELD_META } from "@/lib/fields";
import type { CustomField, FieldOptions, FieldType, PageSize } from "@/lib/types";

export type { FieldOptions, FieldType, PageSize };

/* ------------------------------------------------------------------ types */

/** A participant (signer) or template role the editor assigns fields to. */
export interface EditorParticipant {
  key: string;
  name: string;
  /** index into the participant colour palette (participantColor) */
  colorIndex: number;
}

/** A placed field. Geometry is in PDF points from the TOP-LEFT of the page (1-based `page`). */
export interface EditorField {
  id: string;
  participantKey: string;
  type: FieldType;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  required: boolean;
  options: FieldOptions;
}

/** Workspace 맞춤 입력란 (custom_fields row) usable from the "자동 입력" tab. */
export type EditorCustomField = Pick<
  CustomField,
  "id" | "name" | "type" | "required" | "placeholder" | "default_value" | "options"
>;

export type SignMode = NonNullable<FieldOptions["signMode"]>;
export type AutoFillKind = NonNullable<FieldOptions["autoFill"]>;

/** What an armed tool button creates. */
export type ToolSpec =
  | { kind: "basic"; type: FieldType; signMode?: SignMode }
  | { kind: "auto"; autoFill: AutoFillKind }
  | { kind: "custom"; custom: EditorCustomField };

export interface ArmedTool {
  tool: ToolSpec;
  participantKey: string;
}

/* -------------------------------------------------------------- constants */

/** px per PDF point at 100 % (A4 595pt → 816px). */
export const BASE_SCALE = 816 / 595;
export const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2] as const;
export const MIN_FONT_SIZE = 8;
export const MAX_FONT_SIZE = 20;
export const DEFAULT_FONT_SIZE = 12;
export const MAX_DROPDOWN_ITEMS = 50;

export const SIGN_MODE_LABELS: Record<SignMode, string> = { any: "사인·도장", sign: "사인", stamp: "도장" };

export const AUTO_FILL_META: Record<AutoFillKind, { label: string; w: number; h: number }> = {
  name: { label: "서명자 이름", w: 96, h: 16 },
  company: { label: "회사 이름", w: 128, h: 16 },
  address: { label: "주소", w: 220, h: 16 },
};

export const FORMAT_LABELS: Record<NonNullable<FieldOptions["format"]>, string> = {
  free: "자유 형식",
  number: "숫자",
  email: "이메일",
  phone: "전화번호",
};

/** Field types whose content is a single line of text (font size applies). */
export const TEXT_LIKE: FieldType[] = ["text", "signed_date", "date", "dropdown", "transcribe"];

/* ---------------------------------------------------------------- helpers */

/** RFC 4122 v4 id. Works outside secure contexts (crypto.randomUUID needs https/localhost). */
export function newFieldId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const b = new Uint8Array(16);
  if (c && typeof c.getRandomValues === "function") c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (n) => n.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), Math.max(min, max));

/** Rounds to 0.01pt so stored numbers stay tidy. */
export const round2 = (v: number) => Math.round(v * 100) / 100;

/** Smallest allowed size (points) when resizing. */
export function minSize(type: FieldType): { w: number; h: number } {
  switch (type) {
    case "checkbox":
      return { w: 8, h: 8 };
    case "signature":
    case "image":
      return { w: 20, h: 20 };
    default:
      return { w: 24, h: 10 };
  }
}

/** Template (size + defaults) of the field a tool creates. */
export function toolTemplate(tool: ToolSpec): Pick<EditorField, "type" | "width" | "height" | "required" | "options"> {
  if (tool.kind === "auto") {
    const m = AUTO_FILL_META[tool.autoFill];
    return {
      type: "text",
      width: m.w,
      height: m.h,
      required: true,
      options: { autoFill: tool.autoFill, label: m.label, placeholder: m.label, fontSize: DEFAULT_FONT_SIZE, format: "free" },
    };
  }
  if (tool.kind === "custom") {
    const c = tool.custom;
    const base = { required: c.required, options: { label: c.name } as FieldOptions };
    if (c.placeholder) base.options.placeholder = c.placeholder;
    switch (c.type) {
      case "checkbox":
        return { ...base, type: "checkbox", width: FIELD_META.checkbox.w, height: FIELD_META.checkbox.h };
      case "date":
        return { ...base, type: "date", width: FIELD_META.date.w, height: FIELD_META.date.h, options: { ...base.options, fontSize: DEFAULT_FONT_SIZE } };
      case "dropdown": {
        const items = (Array.isArray(c.options) ? c.options : []).filter((s) => typeof s === "string" && s.trim()).slice(0, MAX_DROPDOWN_ITEMS);
        return {
          ...base,
          type: "dropdown",
          width: FIELD_META.dropdown.w,
          height: FIELD_META.dropdown.h,
          options: { ...base.options, items: items.length ? items : ["항목 1", "항목 2"], fontSize: DEFAULT_FONT_SIZE },
        };
      }
      default:
        return {
          ...base,
          type: "text",
          width: FIELD_META.text.w,
          height: FIELD_META.text.h,
          options: {
            ...base.options,
            fontSize: DEFAULT_FONT_SIZE,
            format: c.type === "number" ? "number" : "free",
            ...(c.default_value ? { defaultText: c.default_value } : {}),
          },
        };
    }
  }
  const meta = FIELD_META[tool.type];
  const t = { type: tool.type, width: meta.w, height: meta.h, required: true, options: {} as FieldOptions };
  switch (tool.type) {
    case "signature":
      t.options = { signMode: tool.signMode ?? "any" };
      break;
    case "text":
      t.options = { fontSize: DEFAULT_FONT_SIZE, format: "free" };
      break;
    case "checkbox":
      t.required = false;
      break;
    case "signed_date":
    case "date":
      t.options = { fontSize: DEFAULT_FONT_SIZE };
      break;
    case "dropdown":
      t.options = { fontSize: DEFAULT_FONT_SIZE, items: ["항목 1", "항목 2"] };
      break;
    case "transcribe":
      t.options = { fontSize: DEFAULT_FONT_SIZE, sentence: "" };
      break;
  }
  return t;
}

/** Keeps a field fully inside its page. */
export function clampToPage(f: EditorField, size: PageSize | undefined): EditorField {
  if (!size) return f;
  const width = Math.min(f.width, size.w);
  const height = Math.min(f.height, size.h);
  return {
    ...f,
    width: round2(width),
    height: round2(height),
    x: round2(clamp(f.x, 0, size.w - width)),
    y: round2(clamp(f.y, 0, size.h - height)),
  };
}

export function createFieldFromTool(
  tool: ToolSpec,
  participantKey: string,
  page: number,
  x: number,
  y: number,
  size: PageSize | undefined,
): EditorField {
  const t = toolTemplate(tool);
  return clampToPage({ id: newFieldId(), participantKey, page, x, y, ...t, options: { ...t.options } }, size);
}

/** Human readable name of a field (properties header, preview captions). */
export function fieldTitle(f: Pick<EditorField, "type" | "options">): string {
  if (f.type === "signature") return SIGN_MODE_LABELS[f.options.signMode ?? "any"];
  if (f.type === "text" && f.options.autoFill) return AUTO_FILL_META[f.options.autoFill].label;
  return FIELD_META[f.type].label;
}

/** Placeholder text drawn inside a text-like field in the editor. */
export function fieldPlaceholder(f: Pick<EditorField, "type" | "options">): string {
  const o = f.options;
  switch (f.type) {
    case "text":
      return o.defaultText || o.placeholder || (o.autoFill ? AUTO_FILL_META[o.autoFill].label : "") || o.label || "텍스트";
    case "signed_date":
      return "#YYYY-MM-DD";
    case "date":
      return o.placeholder || "YYYY-MM-DD";
    case "dropdown":
      return o.placeholder || "선택";
    case "transcribe":
      return o.sentence || o.placeholder || "따라쓰기";
    case "image":
      return "이미지";
    default:
      return "";
  }
}

/** Font size (pt) used for a text-like field. */
export function fieldFontSize(f: Pick<EditorField, "height" | "options">): number {
  return f.options.fontSize ?? Math.min(DEFAULT_FONT_SIZE, Math.max(MIN_FONT_SIZE, f.height * 0.75));
}

/** Validation used before leaving the editor (다음으로). Returns a Korean message or null. */
export function validateFields(
  fields: EditorField[],
  signerKeys: string[],
  opts: { requireEverySigner: boolean },
): string | null {
  if (opts.requireEverySigner) {
    const missing = signerKeys.some((k) => !fields.some((f) => f.participantKey === k));
    if (missing) return "모든 서명자에게 입력란을 1개 이상 배치해 주세요.";
  }
  if (fields.some((f) => f.type === "transcribe" && !(f.options.sentence ?? "").trim())) {
    return "따라쓰기 입력란의 문장을 입력해 주세요.";
  }
  if (fields.some((f) => f.type === "dropdown" && !(f.options.items ?? []).some((s) => s.trim()))) {
    return "드롭다운 입력란에 항목을 1개 이상 입력해 주세요.";
  }
  return null;
}
