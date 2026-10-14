/**
 * 맞춤 입력란 (custom_fields) — reusable field presets of a workspace.
 * Shared by the client form and the Server Actions.
 */
import type { CustomField } from "@/lib/types";

export type CustomFieldType = CustomField["type"];

/** Max number of custom fields per workspace (also enforced by a DB trigger). */
export const CUSTOM_FIELD_LIMIT = 30;

export const CF_LIMITS = {
  name: 20,
  placeholder: 50,
  defaultValue: 100,
  item: 30,
  items: 20,
} as const;

export const CUSTOM_FIELD_TYPES: { value: CustomFieldType; label: string }[] = [
  { value: "text", label: "텍스트" },
  { value: "number", label: "숫자" },
  { value: "date", label: "날짜" },
  { value: "checkbox", label: "체크박스" },
  { value: "dropdown", label: "드롭다운" },
];

export const CUSTOM_FIELD_TYPE_LABEL: Record<CustomFieldType, string> = Object.fromEntries(
  CUSTOM_FIELD_TYPES.map((t) => [t.value, t.label]),
) as Record<CustomFieldType, string>;

export interface CustomFieldInput {
  name: string;
  type: CustomFieldType;
  required: boolean;
  placeholder: string;
  defaultValue: string;
  options: string[];
}

export interface CustomFieldValues {
  name: string;
  type: CustomFieldType;
  required: boolean;
  placeholder: string | null;
  default_value: string | null;
  options: string[];
}

export type CustomFieldErrors = Partial<Record<"name" | "type" | "placeholder" | "defaultValue" | "options", string>>;

const NUMBER_RE = /^-?\d+(\.\d+)?$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidIsoDate(v: string) {
  const m = DATE_RE.exec(v);
  if (!m) return false;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]);
}

export function validateCustomField(input: CustomFieldInput): { values: CustomFieldValues | null; errors: CustomFieldErrors } {
  const errors: CustomFieldErrors = {};
  const name = (input.name ?? "").trim();
  if (!name) errors.name = "입력란 이름을 입력해 주세요.";
  else if (name.length > CF_LIMITS.name) errors.name = `입력란 이름은 ${CF_LIMITS.name}자 이내로 입력해 주세요.`;

  const type = CUSTOM_FIELD_TYPES.some((t) => t.value === input.type) ? input.type : null;
  if (!type) errors.type = "입력란 유형을 선택해 주세요.";

  const placeholder = type === "checkbox" ? "" : (input.placeholder ?? "").trim();
  if (placeholder.length > CF_LIMITS.placeholder) errors.placeholder = `입력 가이드는 ${CF_LIMITS.placeholder}자 이내로 입력해 주세요.`;

  let options: string[] = [];
  if (type === "dropdown") {
    const raw = (input.options ?? []).map((o) => String(o ?? "").trim()).filter(Boolean);
    options = Array.from(new Set(raw));
    if (options.length !== raw.length) errors.options = "드롭다운 항목이 중복되었습니다.";
    else if (options.length < 2) errors.options = "드롭다운 항목을 2개 이상 입력해 주세요.";
    else if (options.length > CF_LIMITS.items) errors.options = `드롭다운 항목은 최대 ${CF_LIMITS.items}개까지 추가할 수 있습니다.`;
    else if (options.some((o) => o.length > CF_LIMITS.item)) errors.options = `드롭다운 항목은 ${CF_LIMITS.item}자 이내로 입력해 주세요.`;
  }

  const rawDefault = (input.defaultValue ?? "").trim();
  let defaultValue: string | null = rawDefault || null;
  switch (type) {
    case "text":
      if (rawDefault.length > CF_LIMITS.defaultValue) errors.defaultValue = `기본값은 ${CF_LIMITS.defaultValue}자 이내로 입력해 주세요.`;
      break;
    case "number":
      if (rawDefault && !NUMBER_RE.test(rawDefault)) errors.defaultValue = "기본값은 숫자로 입력해 주세요.";
      break;
    case "date":
      if (rawDefault && !isValidIsoDate(rawDefault)) errors.defaultValue = "기본값은 YYYY-MM-DD 형식의 날짜로 입력해 주세요.";
      break;
    case "checkbox":
      defaultValue = rawDefault === "true" ? "true" : null;
      break;
    case "dropdown":
      if (rawDefault && !options.includes(rawDefault)) errors.defaultValue = "기본값은 드롭다운 항목 중에서 선택해 주세요.";
      break;
  }

  if (Object.keys(errors).length > 0 || !type) return { values: null, errors };
  return {
    errors,
    values: {
      name,
      type,
      required: !!input.required,
      placeholder: placeholder || null,
      default_value: defaultValue,
      options,
    },
  };
}

/** Text shown in the 기본값 column. */
export function customFieldDefaultLabel(f: Pick<CustomField, "type" | "default_value">) {
  if (f.type === "checkbox") return f.default_value === "true" ? "체크됨" : "체크 안 함";
  return f.default_value || "-";
}
