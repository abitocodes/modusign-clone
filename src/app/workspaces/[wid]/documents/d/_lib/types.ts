import type { DeliveryMethod, DocumentCc, PageSize, RequestType, SigningOrder } from "@/lib/types";

/** Result of a wizard server action. */
export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export const LOCALES = [
  { value: "ko", label: "한국어" },
  { value: "en", label: "English" },
  { value: "ja", label: "日本語" },
  { value: "zh", label: "中文" },
] as const;
export type Locale = (typeof LOCALES)[number]["value"];

/** RFC 4122 v4 id (crypto.randomUUID is missing on insecure origins, e.g. LAN IPs over http) */
export function uuid(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const MAX_PARTICIPANTS = 30;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/* --------------------------------------------------------------- upload */

export interface CreateDraftInput {
  title: string;
  fileName: string;
  pageCount: number;
  pageSizes: PageSize[];
  sizeBytes: number;
}

/* --------------------------------------------------------------- step 1 */

export interface ParticipantInput {
  id: string;
  name: string;
  email: string;
  phone: string;
  delivery: DeliveryMethod | null;
  locale: Locale;
  authPassword: string | null;
  message: string | null;
  requestAttachment: boolean;
  /** role name carried over from a template (shown instead of "서명자 N") */
  roleLabel?: string | null;
}

export interface SaveParticipantsInput {
  requestType: RequestType;
  signingOrder: SigningOrder;
  participants: ParticipantInput[];
}

/** autocomplete suggestion for the 이름 field (주소록 + workspace members) */
export interface PersonSuggestion {
  key: string;
  name: string;
  email: string | null;
  phone: string | null;
  sub: string | null;
  source: "contact" | "member";
}

/* --------------------------------------------------------------- step 3 */

export interface RequestSettingsInput {
  title?: string;
  expiresDays?: number;
  /** null = no lock */
  lockPassword?: string | null;
  labelIds?: string[];
  cc?: DocumentCc[];
}

export const MAX_ATTACHMENTS = 10;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_CC = 10;
