import "server-only";

import { headers } from "next/headers";

import { createAdminClient } from "@/lib/supabase/admin";

export type EventType =
  | "created"
  | "sent"
  | "viewed"
  | "signed"
  | "rejected"
  | "completed"
  | "cancelled"
  | "reminded"
  | "modified";

/** Client IP + user agent of the current request (best effort). */
export async function requestMeta() {
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? h.get("x-real-ip") ?? "").split(",")[0].trim() || "127.0.0.1";
  return { ip, userAgent: h.get("user-agent") ?? "" };
}

/**
 * Appends to the audit trail (진행 이력). `auto` events show "/자동 진행" instead of an IP.
 * Uses the service role so it also works for anonymous signers.
 */
export async function logEvent(
  documentId: string,
  type: EventType,
  actor: { name?: string | null; email?: string | null },
  opts: { auto?: boolean; meta?: Record<string, unknown> } = {},
) {
  const { ip, userAgent } = opts.auto ? { ip: null, userAgent: null } : await requestMeta();
  await createAdminClient()
    .from("document_events")
    .insert({
      document_id: documentId,
      type,
      actor_name: actor.name ?? null,
      actor_email: actor.email ?? null,
      ip,
      user_agent: userAgent,
      meta: { ...(opts.meta ?? {}), auto: !!opts.auto },
    });
}

/** Human readable sentence for an event (서명 진행 정보 > 진행 이력). */
export function describeEvent(e: { type: string; actor_name: string | null; actor_email: string | null; meta: Record<string, unknown> }) {
  const who = `${e.actor_name ?? ""}${e.actor_email ? `(${e.actor_email})` : ""}`;
  switch (e.type) {
    case "created":
      return `${who} 님이 서명 요청을 시작하였습니다.`;
    case "sent":
      return `${who} 님에게 서명할 문서를 전송하였습니다.`;
    case "viewed":
      return `${who} 님이 문서의 내용을 확인하였습니다.`;
    case "signed":
      return `${who} 님이 문서에 서명하였습니다.`;
    case "rejected":
      return `${who} 님이 서명을 거절하였습니다.${e.meta?.reason ? ` (사유: ${String(e.meta.reason)})` : ""}`;
    case "completed":
      return "모든 서명자의 서명이 완료되었습니다.";
    case "cancelled":
      return `${who} 님이 서명 요청을 취소하였습니다.`;
    case "reminded":
      return `${who} 님에게 서명 알림을 다시 보냈습니다.`;
    case "modified":
      return `${who} 님이 문서 내용을 수정하였습니다.`;
    default:
      return `${who} ${e.type}`;
  }
}
