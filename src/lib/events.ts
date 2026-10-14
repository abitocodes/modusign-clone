import "server-only";

import { isIP } from "node:net";

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
  | "modified"
  | "expired"
  | "identity_locked";

const MAX_USER_AGENT = 512;

/**
 * Client IP of the current request, taken from a hop this deployment trusts — never from the
 * client-controlled left end of X-Forwarded-For:
 *  - TRUSTED_IP_HEADER (e.g. "x-real-ip" set by nginx `proxy_set_header X-Real-IP $remote_addr`,
 *    or "x-vercel-forwarded-for"): a header the front proxy overwrites;
 *  - otherwise the entry TRUSTED_PROXY_HOPS (default 1) from the right of X-Forwarded-For, i.e.
 *    the address the closest trusted proxy appended.
 * Returns null when no valid IP address is available.
 */
export function clientIp(h: Pick<Headers, "get">): string | null {
  const header = process.env.TRUSTED_IP_HEADER?.trim().toLowerCase();
  let candidate: string | undefined;
  if (header) {
    candidate = h.get(header)?.split(",")[0];
  } else {
    const hops = Math.max(1, Number.parseInt(process.env.TRUSTED_PROXY_HOPS ?? "1", 10) || 1);
    const parts = (h.get("x-forwarded-for") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    candidate = parts[parts.length - hops];
  }
  const ip = candidate?.trim().replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/, "") ?? "";
  return ip && isIP(ip) ? ip : null;
}

/** Client IP + user agent of the current request (best effort). */
export async function requestMeta() {
  const h = await headers();
  return { ip: clientIp(h), userAgent: (h.get("user-agent") ?? "").slice(0, MAX_USER_AGENT) };
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
    case "expired":
      return "서명 기한이 만료되어 서명이 취소되었습니다.";
    case "identity_locked":
      return `${who} 님의 본인 확인이 여러 번 실패하여 서명이 잠겼습니다.`;
    default:
      return `${who} ${e.type}`;
  }
}
