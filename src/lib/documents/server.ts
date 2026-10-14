import "server-only";

import { describeEvent } from "@/lib/events";
import { createClient } from "@/lib/supabase/server";
import type { DocumentEvent, MemberRole, Participant } from "@/lib/types";

import type { OwnerInfo, ProgressInfo, PublicParticipant } from "./view";

/**
 * Server helpers of the 문서함 area. Everything here uses the RLS-bound server client,
 * so a row that comes back is a row the current user may see.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: unknown): s is string => typeof s === "string" && UUID_RE.test(s);

/** Participant columns selected by this area (access_token is stripped before reaching the browser). */
export const PARTICIPANT_COLUMNS =
  "id, order_index, role, name, email, status, delivery, sent_at, viewed_at, signed_at, expires_at, reject_reason, access_token";

export type RawParticipant = Pick<
  Participant,
  | "id"
  | "order_index"
  | "role"
  | "name"
  | "email"
  | "status"
  | "delivery"
  | "sent_at"
  | "viewed_at"
  | "signed_at"
  | "expires_at"
  | "reject_reason"
  | "access_token"
>;

export function toPublicParticipant(p: RawParticipant): PublicParticipant {
  return {
    id: p.id,
    order_index: p.order_index,
    role: p.role === "viewer" ? "viewer" : "signer",
    name: p.name,
    email: p.email,
    status: p.status,
    sent_at: p.sent_at,
    viewed_at: p.viewed_at,
    signed_at: p.signed_at,
    expires_at: p.expires_at,
    reject_reason: p.reject_reason,
  };
}

/** My access token when it is my turn on this document (pending). */
export function myPendingToken(participants: RawParticipant[], myEmail: string) {
  const me = participants.find((p) => p.status === "pending" && !!p.email && p.email.toLowerCase() === myEmail.toLowerCase());
  return me?.access_token ?? null;
}

export type ServerSupabase = Awaited<ReturnType<typeof createClient>>;

export interface Actor {
  supabase: ServerSupabase;
  userId: string;
  email: string;
  name: string;
  role: MemberRole;
}

/** Current user as a member of workspace `wid` (null when signed out or not a member). */
export async function getActor(wid: string): Promise<Actor | null> {
  if (!isUuid(wid)) return null;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const [{ data: member }, { data: profile }] = await Promise.all([
    supabase.from("workspace_members").select("role").eq("workspace_id", wid).eq("user_id", user.id).maybeSingle(),
    supabase.from("profiles").select("name, email").eq("id", user.id).maybeSingle(),
  ]);
  if (!member) return null;
  return {
    supabase,
    userId: user.id,
    email: (profile?.email ?? user.email ?? "").toLowerCase(),
    name: profile?.name ?? user.email ?? "",
    role: member.role as MemberRole,
  };
}

/** Requester (owner) or a workspace owner/admin may manage a document (cancel, remind, labels, hide …). */
export function canManage(doc: { owner_id: string }, actor: Pick<Actor, "userId" | "role">) {
  return doc.owner_id === actor.userId || actor.role === "owner" || actor.role === "admin";
}

export async function loadOwners(supabase: ServerSupabase, ids: string[]): Promise<Map<string, OwnerInfo>> {
  const unique = [...new Set(ids)];
  const map = new Map<string, OwnerInfo>();
  if (!unique.length) return map;
  const { data } = await supabase.from("profiles").select("id, name, email, avatar_color").in("id", unique);
  for (const p of (data ?? []) as OwnerInfo[]) map.set(p.id, p);
  return map;
}

/**
 * Sends `scheduled` documents whose time has come (there is no cron — the 문서함 calls this on load).
 * Imported lazily so the list keeps working even if the send module fails to load.
 */
export async function dispatchScheduledSafe(wid: string) {
  try {
    const mod: { dispatchScheduled?: (workspaceId: string) => Promise<unknown> } = await import("@/lib/server/send");
    await mod.dispatchScheduled?.(wid);
  } catch (e) {
    console.error("[documents] dispatchScheduled failed:", (e as Error)?.message ?? e);
  }
}

/**
 * 서명 진행 정보: document summary, requester, participants and the described audit trail.
 * Drafts are personal: with `viewerId`, another member's draft is treated as not found.
 */
export async function loadProgressInfo(
  supabase: ServerSupabase,
  wid: string,
  docId: string,
  viewerId?: string,
): Promise<ProgressInfo | null> {
  if (!isUuid(docId)) return null;
  const { data: doc } = await supabase
    .from("documents")
    .select(`id, title, status, request_type, signing_order, requested_at, completed_at, owner_id, participants(${PARTICIPANT_COLUMNS})`)
    .eq("id", docId)
    .eq("workspace_id", wid)
    .maybeSingle();
  if (!doc) return null;
  if (viewerId && doc.status === "draft" && doc.owner_id !== viewerId) return null;

  const [owners, { data: events }] = await Promise.all([
    loadOwners(supabase, [doc.owner_id as string]),
    supabase
      .from("document_events")
      .select("id, type, actor_name, actor_email, ip, meta, created_at")
      .eq("document_id", docId)
      .order("created_at", { ascending: true }),
  ]);
  const owner = owners.get(doc.owner_id as string);

  return {
    doc: {
      id: doc.id,
      title: doc.title,
      status: doc.status,
      request_type: doc.request_type,
      signing_order: doc.signing_order,
      requested_at: doc.requested_at,
      completed_at: doc.completed_at,
    },
    requester: owner ? { name: owner.name, email: owner.email } : null,
    participants: ((doc.participants ?? []) as RawParticipant[])
      .map(toPublicParticipant)
      .sort((a, b) => a.order_index - b.order_index),
    events: ((events ?? []) as Pick<DocumentEvent, "id" | "type" | "actor_name" | "actor_email" | "ip" | "meta" | "created_at">[]).map(
      (e) => ({
        id: e.id,
        text: describeEvent({ type: e.type, actor_name: e.actor_name, actor_email: e.actor_email, meta: e.meta ?? {} }),
        ip: e.ip,
        auto: !!(e.meta as { auto?: boolean } | null)?.auto,
        created_at: e.created_at,
      }),
    ),
  };
}
