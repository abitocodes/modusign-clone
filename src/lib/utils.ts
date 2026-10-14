import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

import type { DocStatus, DocumentRow, Participant, RequestType } from "./types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/* ------------------------------------------------------------------ dates */

const pad = (n: number) => String(n).padStart(2, "0");

/** 2026.10.14 */
export function fmtDate(iso: string | null | undefined) {
  if (!iso) return "-";
  const d = new Date(iso);
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
}

/** 2026.10.14 13:35 */
export function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return "-";
  const d = new Date(iso);
  return `${fmtDate(iso)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 2026-10-14 13:35 */
export function fmtDashDateTime(iso: string | null | undefined) {
  if (!iso) return "-";
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 오후 12:51 (today) / 10-14 13:35 (this year) / 2025-10-14 (older) — used in document tables */
export function fmtShort(iso: string | null | undefined) {
  if (!iso) return "-";
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    const h = d.getHours();
    return `${h < 12 ? "오전" : "오후"} ${h % 12 === 0 ? 12 : h % 12}:${pad(d.getMinutes())}`;
  }
  if (d.getFullYear() !== now.getFullYear()) return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** YYYY-MM-DD */
export function isoDay(d: Date = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/* ---------------------------------------------------------- participants */

export const PARTICIPANT_COLORS = [
  "#ffcf00",
  "#51c8aa",
  "#5991f4",
  "#ff5252",
  "#9b8aff",
  "#c4f02c",
  "#e892f7",
  "#ff8515",
  "#4fdfff",
  "#ff52c5",
] as const;

export function participantColor(index: number) {
  return PARTICIPANT_COLORS[((index % PARTICIPANT_COLORS.length) + PARTICIPANT_COLORS.length) % PARTICIPANT_COLORS.length];
}

/** hex → rgba() with alpha */
export function withAlpha(hex: string, alpha: number) {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function initials(name: string) {
  const n = (name || "?").trim();
  if (/^[a-zA-Z]/.test(n)) return n.slice(0, 2).toUpperCase();
  return n.slice(0, 1);
}

/* ------------------------------------------------------ document statuses */

/** Sidebar filter keys of 문서함 (?status=...) */
export type DocFilter =
  | "all"
  | "need_signing"
  | "wait_for_signing"
  | "need_viewing"
  | "wait_for_viewing"
  | "signing_completed"
  | "viewing_completed"
  | "rejected"
  | "signing_cancelled"
  | "request_cancelled"
  | "draft"
  | "on_modifying"
  | "scheduled";

export const DOC_FILTER_LABELS: Record<DocFilter, string> = {
  all: "모든 상태",
  need_signing: "내 서명 필요",
  wait_for_signing: "상대 서명 대기 중",
  need_viewing: "내 열람 필요",
  wait_for_viewing: "상대 열람 필요",
  signing_completed: "서명 완료",
  viewing_completed: "열람 완료",
  rejected: "서명 거절",
  signing_cancelled: "서명 취소",
  request_cancelled: "요청 취소",
  draft: "작성 중",
  on_modifying: "수정 중",
  scheduled: "예약",
};

export type BadgeTone = "emphasis" | "warning" | "positive" | "negative" | "neutral";

export interface DocBadge {
  label: string;
  tone: BadgeTone;
}

/**
 * The status badge shown for a document from the point of view of `myEmail`.
 * `participants` must belong to the document.
 */
export function documentBadge(
  doc: Pick<DocumentRow, "status" | "request_type">,
  participants: Pick<Participant, "email" | "status">[],
  myEmail: string,
): DocBadge {
  const view = doc.request_type === "view";
  switch (doc.status) {
    case "draft":
      return { label: "작성 중", tone: "neutral" };
    case "on_modifying":
      return { label: "수정 중", tone: "neutral" };
    case "scheduled":
      return { label: "예약", tone: "neutral" };
    case "completed":
      return { label: view ? "열람 완료" : "완료", tone: "positive" };
    case "rejected":
      return { label: "서명 거절", tone: "negative" };
    case "signing_cancelled":
      return { label: "서명 취소", tone: "negative" };
    case "request_cancelled":
      return { label: "요청 취소", tone: "negative" };
    case "in_progress": {
      const me = participants.find((p) => (p.email ?? "").toLowerCase() === myEmail.toLowerCase());
      if (me && me.status === "pending") return { label: view ? "내 열람 필요" : "내 서명 필요", tone: "warning" };
      return { label: view ? "상대 열람 필요" : "상대 서명 필요", tone: "emphasis" };
    }
  }
}

export function docMatchesFilter(
  filter: DocFilter,
  doc: Pick<DocumentRow, "status" | "request_type">,
  participants: Pick<Participant, "email" | "status">[],
  myEmail: string,
) {
  const view = doc.request_type === "view";
  const me = participants.find((p) => (p.email ?? "").toLowerCase() === myEmail.toLowerCase());
  const myTurn = !!me && me.status === "pending";
  switch (filter) {
    case "all":
      return true;
    case "need_signing":
      return doc.status === "in_progress" && !view && myTurn;
    case "wait_for_signing":
      return doc.status === "in_progress" && !view && !myTurn;
    case "need_viewing":
      return doc.status === "in_progress" && view && myTurn;
    case "wait_for_viewing":
      return doc.status === "in_progress" && view && !myTurn;
    case "signing_completed":
      return doc.status === "completed" && !view;
    case "viewing_completed":
      return doc.status === "completed" && view;
    default:
      return doc.status === (filter as DocStatus);
  }
}

export function requestTypeLabel(t: RequestType) {
  return t === "view" ? "열람" : "서명";
}

/** Korean ordinal used in status sentences: 첫 번째, 두 번째 ... */
export function koreanOrdinal(n: number) {
  const words = ["첫", "두", "세", "네", "다섯", "여섯", "일곱", "여덟", "아홉", "열"];
  return `${words[n - 1] ?? n} 번째`;
}

export function bytesLabel(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
