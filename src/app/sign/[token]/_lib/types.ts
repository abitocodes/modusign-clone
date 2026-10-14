/**
 * Client-safe view models of the public signer page (/sign/[token]).
 * Nothing in here may contain secrets (other participants' tokens, passwords, e-mails of others).
 */
import type { SavedSignature } from "@/components/signature";
import type { FieldOptions, FieldType, PageSize, RequestType } from "@/lib/types";

/** One of MY fields (interactive in signing mode). Geometry in PDF points from the page's top-left. */
export interface SignerField {
  id: string;
  type: FieldType;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  required: boolean;
  options: FieldOptions;
}

/** A field another participant already completed — drawn as plain content. */
export interface FilledField {
  id: string;
  type: FieldType;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  options: Pick<FieldOptions, "fontSize">;
  value: string;
}

/** Items of the "…" menu of the top bar. */
export interface SignMenu {
  /** 서명 거절 (my turn, sign request) */
  canReject: boolean;
  /** 문서 다운로드 target (null = hidden) */
  downloadHref: string | null;
}

export interface SignDocument {
  token: string;
  documentId: string;
  title: string;
  requestType: RequestType;
  /** signed URL of the original PDF */
  pdfUrl: string;
  /** page sizes stored with the document (PDF points); pdf.js sizes win once loaded */
  pageSizes: PageSize[];
  me: {
    name: string;
    colorIndex: number;
    /** 남길 말 from the requester */
    message: string | null;
    /** true when the document was already displayed to me after the identity check */
    viewed: boolean;
  };
  requester: { name: string; email: string };
  expiresAt: string | null;
  myFields: SignerField[];
  otherFields: FilledField[];
  /** 임시저장 values */
  draft: Record<string, string>;
  /** saved signatures / stamps of the internal account with my e-mail (undefined = external signer) */
  savedSigns?: SavedSignature[];
  savedStamps?: SavedSignature[];
  /** YYYY-MM-DD (Asia/Seoul) — value of 서명한 날짜 fields */
  today: string;
  menu: SignMenu;
}

/** 내 서명 완료 / 모든 서명 완료 page */
export interface SignDone {
  token: string;
  documentId: string;
  title: string;
  requestType: RequestType;
  /** every participant finished → 모든 서명 완료 */
  completed: boolean;
  signedAt: string | null;
  /** the completed PDF exists (download button enabled) */
  hasCompletedFile: boolean;
  /** read-only preview (original PDF + all submitted values) */
  preview: { pdfUrl: string; pageSizes: PageSize[]; fields: FilledField[] } | null;
  menu: SignMenu;
}

export type MessageKind =
  | "invalid"
  | "unavailable"
  | "not_sent"
  | "modifying"
  | "request_cancelled"
  | "signing_cancelled"
  | "rejected"
  | "rejected_by_me"
  | "expired"
  | "waiting";

export type SignView =
  | { kind: "message"; message: MessageKind; view: boolean; reason?: string | null }
  | {
      kind: "identity";
      token: string;
      /** what the signer has to type */
      check: "email" | "phone";
      needPassword: boolean;
    }
  | { kind: "sign"; doc: SignDocument }
  | { kind: "done"; done: SignDone };

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

export const signDownloadHref = (token: string, type: "original" | "completed" | "current" | "audit") =>
  `/api/sign/${token}/download?type=${type}`;

/** Runs a server action from the browser; a network / server failure becomes a normal error result. */
export async function callAction<T extends { ok: boolean }>(run: () => Promise<T>): Promise<T | { ok: false; error: string }> {
  try {
    return await run();
  } catch {
    return { ok: false, error: "서버와 통신하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }
}
