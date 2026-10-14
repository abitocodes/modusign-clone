import type { DocStatus, ParticipantStatus, RequestType } from "@/lib/types";

/** Results of the preview-only server actions (./actions.ts). */
export type PreviewResult<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };

export interface PreviewSignerLink {
  id: string;
  name: string;
  email: string | null;
  status: ParticipantStatus;
  /** /sign/<access_token> */
  href: string;
}

/** In-progress document with the participants whose turn it is (PreviewBadge). */
export interface PreviewPendingDoc {
  id: string;
  title: string;
  workspaceId: string;
  requestType: RequestType;
  signers: PreviewSignerLink[];
}

export interface PreviewPendingList {
  signedIn: boolean;
  docs: PreviewPendingDoc[];
}

/** Every participant of one document (PreviewSignerTools). */
export interface PreviewDocumentSigners {
  status: DocStatus;
  requestType: RequestType;
  workspaceId: string;
  /** requester / workspace admin: may run "모든 서명자 서명 완료 처리" */
  canSimulate: boolean;
  signers: PreviewSignerLink[];
}
