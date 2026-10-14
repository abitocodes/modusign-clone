/**
 * Client-safe view models + wording helpers for the 문서함 area
 * (document list, row panel, 서명 진행 정보, read-only viewer, reminders, data export).
 */
import type { DocStatus, ParticipantStatus, RequestType, SigningOrder } from "@/lib/types";
import { fmtDashDateTime, koreanOrdinal } from "@/lib/utils";

/** Participant without secrets (no access token / password) — safe to send to the browser. */
export interface PublicParticipant {
  id: string;
  order_index: number;
  role: "signer" | "viewer";
  name: string;
  email: string | null;
  status: ParticipantStatus;
  sent_at: string | null;
  viewed_at: string | null;
  signed_at: string | null;
  expires_at: string | null;
  reject_reason: string | null;
}

export interface OwnerInfo {
  id: string;
  name: string;
  email: string;
  avatar_color: string;
}

/** One row of the 문서함 table. */
export interface DocListItem {
  id: string;
  title: string;
  status: DocStatus;
  request_type: RequestType;
  signing_order: SigningOrder;
  owner: OwnerInfo | null;
  hasOriginal: boolean;
  hasCompleted: boolean;
  label_ids: string[];
  hidden: boolean;
  scheduled_at: string | null;
  requested_at: string | null;
  completed_at: string | null;
  last_activity_at: string;
  participants: PublicParticipant[];
  /** my own access token when it is my turn (pending) — used for the 서명하기 / 거절 links */
  myToken: string | null;
  /** pending 직접 대면 signers (managers of an in-progress document only) — 직접 대면 서명 시작 */
  inPersonPending: { id: string; name: string }[];
  /** requester (owner) or workspace admin */
  canManage: boolean;
  isOwner: boolean;
}

export interface ProgressEvent {
  id: string;
  text: string;
  ip: string | null;
  auto: boolean;
  created_at: string;
}

/** Data of the 서명 진행 정보 modal / viewer side panel. */
export interface ProgressInfo {
  doc: {
    id: string;
    title: string;
    status: DocStatus;
    request_type: RequestType;
    signing_order: SigningOrder;
    requested_at: string | null;
    completed_at: string | null;
  };
  requester: { name: string; email: string } | null;
  participants: PublicParticipant[];
  events: ProgressEvent[];
}

/* ------------------------------------------------------------------ wording */

const pad = (n: number) => String(n).padStart(2, "0");

/** 2026-10-14 12:51:41 */
export function fmtSeconds(iso: string | null | undefined) {
  if (!iso) return "-";
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 2026년 10월 28일 오후 12시 51분 */
export function fmtKoreanDateTime(iso: string) {
  const d = new Date(iso);
  const h = d.getHours();
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${h < 12 ? "오전" : "오후"} ${h % 12 === 0 ? 12 : h % 12}시 ${pad(d.getMinutes())}분`;
}

export function sortParticipants<T extends { order_index: number }>(list: T[]) {
  return [...list].sort((a, b) => a.order_index - b.order_index);
}

export function isMe(p: { email: string | null }, myEmail: string) {
  return !!p.email && !!myEmail && p.email.toLowerCase() === myEmail.toLowerCase();
}

/** 서명 진행 상태 (document level) */
export function docProgressLabel(status: DocStatus, requestType: RequestType) {
  const verb = requestType === "view" ? "열람" : "서명";
  switch (status) {
    case "in_progress":
      return `${verb} 진행 중`;
    case "completed":
      return `${verb} 완료`;
    case "rejected":
      return "서명 거절";
    case "request_cancelled":
      return "요청 취소";
    case "signing_cancelled":
      return "서명 취소";
    case "draft":
      return "작성 중";
    case "on_modifying":
      return "수정 중";
    case "scheduled":
      return "전송 예약";
  }
}

/**
 * Participant status as it should be shown for a document in `docStatus`:
 * once a request is closed (거절 / 취소) the participants who never acted are "stopped" (미서명),
 * and while it is paused (작성 중 / 수정 중 / 예약) nobody is asked to sign yet (대기 중).
 */
export type DisplayParticipantStatus = ParticipantStatus | "stopped";

export function displayParticipantStatus(status: ParticipantStatus, docStatus: DocStatus): DisplayParticipantStatus {
  if (status !== "pending" && status !== "waiting") return status;
  switch (docStatus) {
    case "rejected":
    case "request_cancelled":
    case "signing_cancelled":
      return "stopped";
    case "draft":
    case "on_modifying":
    case "scheduled":
      return "waiting";
    default:
      return status;
  }
}

/** 진행 상태 of one participant (pass the result of displayParticipantStatus) */
export function participantStatusLabel(status: DisplayParticipantStatus, requestType: RequestType) {
  const view = requestType === "view";
  switch (status) {
    case "stopped":
      return view ? "미열람" : "미서명";
    case "signed":
      return view ? "열람 완료" : "서명 완료";
    case "viewed":
      return view ? "열람 완료" : "내용 확인";
    case "pending":
      return view ? "열람 필요" : "서명 필요";
    case "waiting":
      return "대기 중";
    case "rejected":
      return "서명 거절";
  }
}

/**
 * Has anybody already completed (signed / viewed / rejected) their part?
 * Status "viewed" only occurs for finished viewers of a view request (sign requests keep "pending"
 * while viewed_at is set), so merely opening a sign request does not count.
 */
export function anyoneActed(participants: Pick<PublicParticipant, "status" | "signed_at">[]) {
  return participants.some((p) => p.status === "signed" || p.status === "viewed" || p.status === "rejected" || !!p.signed_at);
}

/** Headline of the row panel, e.g. "두 번째 서명자의 서명을 기다리고 있습니다." */
export function statusSentence(
  doc: { status: DocStatus; request_type: RequestType; signing_order: SigningOrder; scheduled_at?: string | null },
  participants: PublicParticipant[],
  myEmail: string,
) {
  const view = doc.request_type === "view";
  const noun = view ? "열람자" : "서명자";
  const verb = view ? "열람" : "서명";
  const sorted = sortParticipants(participants);
  switch (doc.status) {
    case "in_progress": {
      const current = sorted.find((p) => p.status === "pending");
      if (current && isMe(current, myEmail)) return `내 ${verb}을 기다리고 있습니다.`;
      if (doc.signing_order === "sequential" && current) {
        return `${koreanOrdinal(sorted.indexOf(current) + 1)} ${noun}의 ${verb}을 기다리고 있습니다.`;
      }
      return `${noun}의 ${verb}을 기다리고 있습니다.`;
    }
    case "completed":
      return `문서의 모든 ${verb}이 완료되었습니다.`;
    case "rejected": {
      const r = sorted.find((p) => p.status === "rejected");
      return r ? `${r.name} 님이 서명을 거절했습니다.` : "서명이 거절되었습니다.";
    }
    case "request_cancelled":
      return "요청자가 서명 요청을 취소했습니다.";
    case "signing_cancelled":
      return "서명이 취소되었습니다.";
    case "scheduled":
      return doc.scheduled_at ? `${fmtDashDateTime(doc.scheduled_at)}에 전송될 예정입니다.` : "전송이 예약된 문서입니다.";
    case "draft":
      return "작성 중인 문서입니다.";
    case "on_modifying":
      return "수정 중인 문서입니다.";
  }
}

/* --------------------------------------------------------------- links */

export const documentsHome = (wid: string) => `/workspaces/${wid}/esign/documents/documents?status=all`;
export const viewerHref = (wid: string, docId: string) => `/workspaces/${wid}/documents/${docId}`;
export const wizardHref = (wid: string, docId: string) => `/workspaces/${wid}/documents/d/${docId}/steps/1`;
export const downloadHref = (docId: string, type: "original" | "completed") => `/api/documents/${docId}/download?type=${type}`;

/** Statuses from which the requester may cancel the request (수정 중 included: its signers were notified). */
export const CANCELLABLE_STATUSES: DocStatus[] = ["in_progress", "scheduled", "on_modifying"];

/* ---------------------------------------------------------- date ranges */

/** "26.10.01" | "2026.10.01" | "26-10-01" → "2026-10-01" (null when invalid) */
export function parseDay(input: string): string | null {
  const m = input.trim().match(/^(\d{2}|\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})$/);
  if (!m) return null;
  const y = m[1].length === 2 ? 2000 + Number(m[1]) : Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(mo)}-${pad(d)}`;
}

/** Parses "YY.MM.DD ~ YY.MM.DD". Empty → no range. Returns "invalid" for malformed / reversed ranges. */
export function parseDateRangeText(text: string): { from: string | null; to: string | null } | "invalid" {
  const t = text.trim();
  if (!t) return { from: null, to: null };
  const parts = t.split("~").map((s) => s.trim());
  if (parts.length > 2) return "invalid";
  if (parts.length === 1) {
    const d = parseDay(parts[0]);
    return d ? { from: d, to: d } : "invalid";
  }
  const from = parts[0] ? parseDay(parts[0]) : null;
  const to = parts[1] ? parseDay(parts[1]) : null;
  if ((parts[0] && !from) || (parts[1] && !to) || (!from && !to)) return "invalid";
  if (from && to && from > to) return "invalid";
  return { from, to };
}

const short = (day: string | null) => (day ? `${day.slice(2, 4)}.${day.slice(5, 7)}.${day.slice(8, 10)}` : "");

/** "2026-10-01","2026-10-14" → "26.10.01 ~ 26.10.14" */
export function formatDateRangeText(from: string | null, to: string | null) {
  if (!from && !to) return "";
  return `${short(from)} ~ ${short(to)}`;
}

export const isIsoDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && parseDay(s) !== null;

/** Inclusive day range → [gte, lt) timestamps in KST (the service is used in Korea). */
export function dayRangeToTimestamps(from: string | null, to: string | null) {
  const next = (day: string) => {
    const [y, m, d] = day.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + 1));
    return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
  };
  return {
    gte: from ? `${from}T00:00:00+09:00` : null,
    lt: to ? `${next(to)}T00:00:00+09:00` : null,
  };
}
