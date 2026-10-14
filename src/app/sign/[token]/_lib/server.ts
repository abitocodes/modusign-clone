import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

import { isUuid } from "@/lib/documents/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { DocumentRow, FieldRow, Participant, Profile } from "@/lib/types";

/**
 * Token-authorised data access of the public signer flow.
 *
 * The access token (participants.access_token) identifies the participant; the identity check
 * then proves the person holds the invited mailbox. Every server action / download re-runs
 * `loadSignContext` + `isVerified` before touching data with the service role.
 */

export type AdminClient = ReturnType<typeof createAdminClient>;

export interface SignContext {
  admin: AdminClient;
  me: Participant;
  doc: DocumentRow;
  /** every participant of the document, ordered */
  participants: Participant[];
  fields: FieldRow[];
  owner: Pick<Profile, "id" | "name" | "email"> | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
export const VERIFY_COOKIE_MAX_AGE = 7 * 24 * 60 * 60;

export async function loadSignContext(token: string): Promise<SignContext | null> {
  if (!isUuid(token)) return null;
  const admin = createAdminClient();
  const { data: me } = await admin.from("participants").select("*").eq("access_token", token.toLowerCase()).maybeSingle();
  if (!me) return null;
  const participant = me as Participant;
  const { data: doc } = await admin.from("documents").select("*").eq("id", participant.document_id).maybeSingle();
  if (!doc) return null;
  const document = doc as DocumentRow;
  const [{ data: parts }, { data: fields }, { data: owner }] = await Promise.all([
    admin.from("participants").select("*").eq("document_id", document.id).order("order_index"),
    admin.from("fields").select("*").eq("document_id", document.id).order("created_at"),
    admin.from("profiles").select("id, name, email").eq("id", document.owner_id).maybeSingle(),
  ]);
  return {
    admin,
    me: participant,
    doc: document,
    participants: (parts ?? []) as Participant[],
    fields: (fields ?? []) as FieldRow[],
    owner: (owner ?? null) as SignContext["owner"],
  };
}

/* ------------------------------------------------------------ identity cookie */

export const verifyCookieName = (participantId: string) => `sign_${participantId}`;

/**
 * Key of the identity cookie: SIGN_COOKIE_SECRET (≥ 32 characters). Until it is configured, a key
 * derived (domain-separated) from the service-role secret is used. Never an empty key: without
 * either secret the check fails closed.
 */
function cookieKey(): string {
  const dedicated = process.env.SIGN_COOKIE_SECRET?.trim();
  if (dedicated && dedicated.length >= 32) return dedicated;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!service) throw new Error("SIGN_COOKIE_SECRET is not configured");
  return createHmac("sha256", service).update("opensign/sign-identity-cookie/v2").digest("hex");
}

/**
 * HMAC-SHA256 over the facts the identity check verified: the participant, its access token, the
 * invited contact, the delivery method, the 인증 비밀번호 and the time the request was sent. A change of
 * any of them (내용 수정, re-send) invalidates cookies issued before.
 */
export function verifyCookieValue(me: Pick<Participant, "id" | "access_token" | "email" | "phone" | "delivery" | "auth_password" | "sent_at">) {
  const facts = [
    me.id,
    me.access_token,
    (me.email ?? "").trim().toLowerCase(),
    (me.phone ?? "").replace(/\D/g, ""),
    me.delivery ?? "",
    me.auth_password ?? "",
    me.sent_at ? new Date(me.sent_at).toISOString() : "",
  ];
  return createHmac("sha256", cookieKey()).update(facts.join("\n")).digest("hex");
}

export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** e-mail of the logged-in employee, if any (internal signers open the same link) */
export async function sessionEmail(): Promise<string | null> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user?.email?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

/** What the identity check asks for. `null` = no check (직접 대면). */
export function identityCheck(me: Participant): "email" | "phone" | null {
  if (me.delivery === "in_person") return null;
  if (me.delivery === "kakao" && me.phone && !me.email) return "phone";
  return "email";
}

/**
 * Has the current browser passed the identity check for this participant?
 *  - 직접 대면 (in person): the requester hands the device over — no check
 *  - a valid `sign_<participantId>` cookie (set by the identity check)
 *  - a logged-in employee whose e-mail is the invited one (only when no 인증 비밀번호 is set)
 */
export async function isVerified(me: Participant): Promise<boolean> {
  if (identityCheck(me) === null) return true;
  const jar = await cookies();
  const value = jar.get(verifyCookieName(me.id))?.value;
  if (value) {
    try {
      if (safeEqual(value, verifyCookieValue(me))) return true;
    } catch (e) {
      console.error("[sign] identity cookie cannot be checked:", (e as Error).message);
    }
  }
  if (!me.auth_password && me.email) {
    const email = await sessionEmail();
    if (email && email === me.email.toLowerCase()) return true;
  }
  return false;
}

export async function setVerifiedCookie(me: Participant) {
  const jar = await cookies();
  jar.set(verifyCookieName(me.id), verifyCookieValue(me), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: VERIFY_COOKIE_MAX_AGE,
  });
}

/* ------------------------------------------------- identity-check throttle */

/**
 * Failed identity checks are kept in public.participant_identity_attempts (shared by every server
 * process): exponential back-off from the 5th failure, permanent lock after 20 failures until the
 * requester re-sends (sign_identity_register_failure). `locked_until` null = not locked.
 */
export type IdentityLock = { until: Date; permanent: boolean } | null;

function toLock(value: string | null | undefined, now = Date.now()): IdentityLock {
  if (!value) return null;
  if (value === "infinity") return { until: new Date(8.64e15), permanent: true };
  const until = new Date(value);
  if (Number.isNaN(until.getTime()) || until.getTime() <= now) return null;
  return { until, permanent: false };
}

/** Current lock of the participant's identity check. Fails closed when the state cannot be read. */
export async function identityLock(admin: AdminClient, participantId: string): Promise<IdentityLock> {
  const { data, error } = await admin
    .from("participant_identity_attempts")
    .select("locked_until")
    .eq("participant_id", participantId)
    .maybeSingle();
  if (error) {
    console.error("[sign] identity throttle unavailable:", error.message);
    return { until: new Date(Date.now() + 60_000), permanent: false };
  }
  return toLock((data as { locked_until: string | null } | null)?.locked_until);
}

/** Records a failed check; returns the lock that applies from now on. */
export async function recordIdentityFailure(admin: AdminClient, participantId: string): Promise<IdentityLock> {
  const { data, error } = await admin.rpc("sign_identity_register_failure", { p_participant: participantId });
  if (error) {
    console.error("[sign] identity failure not recorded:", error.message);
    return { until: new Date(Date.now() + 60_000), permanent: false };
  }
  return toLock(data as string | null);
}

/** A successful check resets the back-off (the lifetime counter stays until the request is re-sent). */
export async function clearIdentityFailures(admin: AdminClient, participantId: string) {
  await admin.from("participant_identity_attempts").update({ failures: 0, locked_until: null }).eq("participant_id", participantId);
}

/** Re-sent / reminded / next in turn: the requester issued the request again → all counters reset. */
export async function resetIdentityAttempts(admin: AdminClient, participantIds: string[]) {
  if (!participantIds.length) return;
  const { error } = await admin.from("participant_identity_attempts").delete().in("participant_id", participantIds);
  if (error) console.error("[sign] identity counters not reset:", error.message);
}

/** Message of a locked check with the unlock time in Korea time, e.g. "10월 14일 오후 3:20" */
export function lockMessage(lock: NonNullable<IdentityLock>) {
  if (lock.permanent) return "본인 확인에 여러 번 실패해 서명이 잠겼습니다. 요청자에게 재전송을 요청해 주세요.";
  const when = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(lock.until);
  return `본인 확인에 여러 번 실패했습니다. ${when} 이후에 다시 시도해 주세요.`;
}

/* ------------------------------------------------------------------ helpers */

/** YYYY-MM-DD in Korea (서명한 날짜) */
export function seoulDay(d: Date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function isExpired(me: Pick<Participant, "expires_at">, now = Date.now()) {
  return !!me.expires_at && new Date(me.expires_at).getTime() < now;
}

export function expiresAtFrom(days: number, from = new Date()) {
  return new Date(from.getTime() + Math.max(1, days) * DAY_MS).toISOString();
}

/** A signer is done when signed (sign request) / viewed (view request). */
export function isDone(p: Pick<Participant, "status">, requestType: DocumentRow["request_type"]) {
  return requestType === "view" ? p.status === "viewed" || p.status === "signed" : p.status === "signed";
}

export function colorIndexOf(ctx: Pick<SignContext, "participants" | "me">) {
  const i = ctx.participants.findIndex((p) => p.id === ctx.me.id);
  return i < 0 ? 0 : i;
}

/** "계약서/2026:최종?" → "계약서_2026_최종_.pdf" */
export function safePdfName(title: string, suffix = "") {
  const base = title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/\s+/g, " ").trim().slice(0, 120);
  return `${base || "document"}${suffix}.pdf`;
}
