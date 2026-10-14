/**
 * 주소록 (contacts) — validation / normalisation shared by the client form and the Server Actions.
 */
import type { Contact } from "@/lib/types";

export type ContactChannel = Contact["default_channel"];

export const CONTACT_LIMITS = {
  name: 30,
  description: 100,
  company: 50,
  position: 30,
  importRows: 500,
} as const;

export const CHANNEL_LABELS: Record<ContactChannel, string> = { phone: "휴대폰", email: "이메일" };

/** Domains suggested by the e-mail autocomplete of the 새 연락처 form. */
export const EMAIL_DOMAINS = ["gmail.com", "naver.com", "daum.net", "hanmail.net", "kakao.com", "nate.com", "outlook.com"];

const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[^\s@.]{2,}$/;

export function isValidEmail(v: string) {
  const s = v.trim();
  return s.length <= 254 && EMAIL_RE.test(s);
}

export const digitsOnly = (v: string) => v.replace(/\D/g, "");

/**
 * Korean mobile numbers (010 only, like the original form).
 * Accepts `12345678`, `01012345678`, `010-1234-5678`, `1012345678` (Excel dropped the leading 0)
 * and returns `010-1234-5678`, or null when invalid.
 */
export function normalizePhone(raw: string): string | null {
  const d = digitsOnly(raw);
  let rest: string | null = null;
  if (d.length === 8) rest = d;
  else if (d.length === 11 && d.startsWith("010")) rest = d.slice(3);
  else if (d.length === 10 && d.startsWith("10")) rest = d.slice(2);
  if (!rest) return null;
  return `010-${rest.slice(0, 4)}-${rest.slice(4)}`;
}

/** `010-1234-5678` → `12345678` (the part typed after the fixed "010-" prefix) */
export function phoneSuffix(phone: string | null | undefined) {
  if (!phone) return "";
  const d = digitsOnly(phone);
  return d.length === 11 && d.startsWith("010") ? d.slice(3) : d.slice(-8);
}

/** 사업자등록번호 → `123-45-67890`, null when not 10 digits */
export function normalizeBusinessNo(raw: string): string | null {
  const d = digitsOnly(raw);
  if (d.length !== 10) return null;
  return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
}

export interface ContactInput {
  name: string;
  /** full number or just the 8 digits after "010-" */
  phone: string;
  email: string;
  defaultChannel: ContactChannel | null;
  description: string;
  company: string;
  position: string;
  businessNo: string;
}

/** Column values written to public.contacts */
export interface ContactValues {
  name: string;
  phone: string | null;
  email: string | null;
  default_channel: ContactChannel;
  description: string | null;
  company: string | null;
  position: string | null;
  business_no: string | null;
}

export type ContactErrorKey =
  | "name"
  | "phone"
  | "email"
  | "channel"
  | "defaultChannel"
  | "description"
  | "company"
  | "position"
  | "businessNo";
export type ContactErrors = Partial<Record<ContactErrorKey, string>>;

export function validateContact(input: ContactInput): { values: ContactValues | null; errors: ContactErrors } {
  const errors: ContactErrors = {};
  const name = (input.name ?? "").trim();
  if (!name) errors.name = "이름을 입력해 주세요.";
  else if (name.length > CONTACT_LIMITS.name) errors.name = `이름은 ${CONTACT_LIMITS.name}자 이내로 입력해 주세요.`;

  const phoneRaw = (input.phone ?? "").trim();
  const phone = phoneRaw ? normalizePhone(phoneRaw) : null;
  if (phoneRaw && !phone) errors.phone = "휴대폰 번호 형식이 올바르지 않습니다. (010 + 8자리 숫자)";

  const email = (input.email ?? "").trim().toLowerCase();
  if (email && !isValidEmail(email)) errors.email = "올바른 이메일 주소를 입력해 주세요.";

  if (!phoneRaw && !email) errors.channel = "휴대폰 또는 이메일을 한 개 이상 입력해 주세요.";

  let channel: ContactChannel | null = input.defaultChannel === "phone" || input.defaultChannel === "email" ? input.defaultChannel : null;
  if (channel === "phone" && !phoneRaw) errors.defaultChannel = "기본 전송 수단으로 선택한 휴대폰 번호를 입력해 주세요.";
  if (channel === "email" && !email) errors.defaultChannel = "기본 전송 수단으로 선택한 이메일 주소를 입력해 주세요.";
  if (!channel) channel = phone ? "phone" : "email";

  const description = (input.description ?? "").trim();
  if (description.length > CONTACT_LIMITS.description) errors.description = `설명은 ${CONTACT_LIMITS.description}자 이하로 입력해 주세요.`;

  const company = (input.company ?? "").trim();
  if (company.length > CONTACT_LIMITS.company) errors.company = `회사명은 ${CONTACT_LIMITS.company}자 이내로 입력해 주세요.`;
  const position = (input.position ?? "").trim();
  if (position.length > CONTACT_LIMITS.position) errors.position = `직위는 ${CONTACT_LIMITS.position}자 이내로 입력해 주세요.`;
  const businessRaw = (input.businessNo ?? "").trim();
  const businessNo = businessRaw ? normalizeBusinessNo(businessRaw) : null;
  if (businessRaw && !businessNo) errors.businessNo = "사업자등록번호 10자리를 숫자로 입력해 주세요.";

  if (Object.keys(errors).length > 0) return { values: null, errors };
  return {
    errors,
    values: {
      name,
      phone,
      email: email || null,
      default_channel: channel,
      description: description || null,
      company: company || null,
      position: position || null,
      business_no: businessNo,
    },
  };
}

export function firstError(errors: ContactErrors | Record<string, string | undefined>) {
  return Object.values(errors).find(Boolean) ?? "입력값을 확인해 주세요.";
}

/* -------------------------------------------------------------- CSV import */

/** Minimal RFC-4180 parser (quotes, escaped quotes, CRLF). Tab separated text (pasted from a sheet) works too. */
export function parseDelimited(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const delim = firstLine.includes("\t") && !firstLine.includes(",") ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === "") quoted = true;
    else if (ch === delim) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ""));
}

export interface ImportRow {
  /** 1-based line number in the source */
  line: number;
  name: string;
  phone: string;
  email: string;
  company: string;
  values: ContactValues | null;
  error: string | null;
}

const HEADER_NAMES = ["이름", "name", "성명", "성함"];

const dupKey = (name: string, email: string | null, phone: string | null) =>
  `${name.trim().toLowerCase()}|${(email ?? "").toLowerCase()}|${phone ?? ""}`;

/** 이름,휴대폰,이메일,회사명 rows → validated rows (duplicates inside the file / address book are rejected). */
export function parseContactsImport(
  text: string,
  existing: Pick<Contact, "name" | "email" | "phone">[] = [],
): ImportRow[] {
  const table = parseDelimited(text);
  const seen = new Set(existing.map((c) => dupKey(c.name, c.email, c.phone)));
  const out: ImportRow[] = [];
  table.forEach((cells, idx) => {
    if (idx === 0 && HEADER_NAMES.includes((cells[0] ?? "").toLowerCase())) return;
    const [name = "", phone = "", email = "", company = ""] = cells;
    const { values, errors } = validateContact({
      name,
      phone,
      email,
      defaultChannel: email.trim() ? "email" : phone.trim() ? "phone" : null,
      description: "",
      company,
      position: "",
      businessNo: "",
    });
    let error = values ? null : firstError(errors);
    if (values) {
      const key = dupKey(values.name, values.email, values.phone);
      if (seen.has(key)) error = "이미 등록되었거나 중복된 연락처입니다.";
      seen.add(key);
    }
    out.push({ line: idx + 1, name, phone, email, company, values: error ? null : values, error });
  });
  return out;
}

export const CONTACTS_CSV_TEMPLATE = "﻿이름,휴대폰,이메일,회사명\r\n홍길동,010-1234-5678,hong@example.com,예시회사\r\n";
