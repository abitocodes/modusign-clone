/**
 * Field value rules of the signer flow — shared by the browser (inline errors, progress counter)
 * and the server actions (authoritative validation before anything is stored).
 */
import { FIELD_META } from "@/lib/fields";
import type { FieldOptions, FieldType } from "@/lib/types";

export interface ValidatableField {
  type: FieldType;
  required: boolean;
  options: FieldOptions;
}

/** max length of a data URL (signature / image) ≈ 2 MB of binary data */
export const MAX_IMAGE_DATA_URL = 2_900_000;
export const MAX_TEXT_LENGTH = 500;
export const MAX_TRANSCRIBE_LENGTH = 1000;
export const MAX_REJECT_REASON = 500;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^\+?[\d\s-]{8,16}$/;
const NUMBER_RE = /^-?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const IMAGE_RE = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/;

/** Fields the signer completes by hand (서명한 날짜 is filled automatically). */
export function isManual(f: Pick<ValidatableField, "type">) {
  return f.type !== "signed_date";
}

/** Fields counted by the bottom bar: required + manual. */
export function isCounted(f: Pick<ValidatableField, "type" | "required">) {
  return f.required && isManual(f);
}

export function normalizeSentence(s: string) {
  return s.replace(/\s+/g, " ").trim();
}

export function isValidDay(v: string) {
  const m = DATE_RE.exec(v);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

/** "(필수) 텍스트" label of a field */
export function fieldLabel(f: Pick<ValidatableField, "type" | "options">) {
  if (f.options.label?.trim()) return f.options.label.trim();
  if (f.type === "signature") {
    if (f.options.signMode === "sign") return "사인";
    if (f.options.signMode === "stamp") return "도장";
  }
  return FIELD_META[f.type].label;
}

/** Does `value` count as filled for this field? (format errors aside) */
export function hasValue(f: Pick<ValidatableField, "type">, value: string | undefined | null) {
  if (value == null) return false;
  if (f.type === "checkbox") return value === "true";
  return value.trim().length > 0;
}

/**
 * Error message for a value, or null when it is acceptable.
 * Empty values are only an error for required fields (`checkRequired`).
 */
export function fieldError(f: ValidatableField, value: string | undefined | null, checkRequired = true): string | null {
  const v = value ?? "";
  if (!hasValue(f, v)) {
    if (!checkRequired || !f.required || !isManual(f)) return null;
    switch (f.type) {
      case "signature":
        return "서명을 입력해 주세요.";
      case "checkbox":
        return "필수 항목에 체크해 주세요.";
      case "image":
        return "이미지를 첨부해 주세요.";
      case "dropdown":
        return "항목을 선택해 주세요.";
      case "date":
        return "날짜를 선택해 주세요.";
      default:
        return "내용을 입력해 주세요.";
    }
  }
  switch (f.type) {
    case "signature":
    case "image":
      if (v.length > MAX_IMAGE_DATA_URL) return "이미지 용량이 너무 큽니다.";
      return IMAGE_RE.test(v) ? null : "올바른 이미지가 아닙니다.";
    case "checkbox":
      return v === "true" ? null : "올바르지 않은 값입니다.";
    case "date":
      return isValidDay(v) ? null : "날짜 형식(YYYY-MM-DD)을 확인해 주세요.";
    case "signed_date":
      return null;
    case "dropdown": {
      const items = (f.options.items ?? []).filter(Boolean);
      return items.length === 0 || items.includes(v) ? null : "목록에 있는 항목을 선택해 주세요.";
    }
    case "transcribe": {
      if (v.length > MAX_TRANSCRIBE_LENGTH) return `${MAX_TRANSCRIBE_LENGTH}자 이내로 입력해 주세요.`;
      const target = normalizeSentence(f.options.sentence ?? "");
      if (target && normalizeSentence(v) !== target) return "제시된 문장을 똑같이 입력해 주세요.";
      return null;
    }
    case "text": {
      if (v.length > MAX_TEXT_LENGTH) return `${MAX_TEXT_LENGTH}자 이내로 입력해 주세요.`;
      const t = v.trim();
      switch (f.options.format) {
        case "number":
          return NUMBER_RE.test(t) ? null : "숫자만 입력해 주세요.";
        case "email":
          return EMAIL_RE.test(t) ? null : "이메일 형식이 올바르지 않습니다.";
        case "phone":
          return PHONE_RE.test(t) && t.replace(/\D/g, "").length >= 8 ? null : "전화번호 형식이 올바르지 않습니다.";
        default:
          return null;
      }
    }
  }
}

/** Value a field starts with: 임시저장 → 자동 입력(이름) → 기본 텍스트. */
export function initialValue(f: ValidatableField, draft: Record<string, string>, id: string, myName: string) {
  const saved = draft[id];
  if (typeof saved === "string") return saved;
  if (f.type === "text" && f.options.autoFill === "name") return myName;
  if (f.type === "text" && f.options.defaultText) return f.options.defaultText;
  return "";
}
