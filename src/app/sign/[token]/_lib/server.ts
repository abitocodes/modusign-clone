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

/** HMAC-SHA256 of the access token, keyed with the service-role secret. */
export function verifyCookieValue(accessToken: string) {
  return createHmac("sha256", process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").update(accessToken).digest("hex");
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
  if (value && safeEqual(value, verifyCookieValue(me.access_token))) return true;
  if (!me.auth_password && me.email) {
    const email = await sessionEmail();
    if (email && email === me.email.toLowerCase()) return true;
  }
  return false;
}

export async function setVerifiedCookie(me: Participant) {
  const jar = await cookies();
  jar.set(verifyCookieName(me.id), verifyCookieValue(me.access_token), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: VERIFY_COOKIE_MAX_AGE,
  });
}

/* ------------------------------------------------- identity-check throttle */

/**
 * Failed identity checks per participant (in-memory, per server process): after
 * IDENTITY_MAX_FAILURES wrong answers the check is locked for IDENTITY_LOCK_MS.
 */
const IDENTITY_MAX_FAILURES = 10;
const IDENTITY_LOCK_MS = 10 * 60 * 1000;
const identityFailures = new Map<string, { count: number; until: number }>();

/** true while the participant's identity check is locked after too many failures */
export function identityLocked(participantId: string, now = Date.now()) {
  const entry = identityFailures.get(participantId);
  if (!entry) return false;
  if (entry.until <= now) {
    identityFailures.delete(participantId);
    return false;
  }
  return entry.count >= IDENTITY_MAX_FAILURES;
}

export function recordIdentityFailure(participantId: string, now = Date.now()) {
  const entry = identityFailures.get(participantId);
  const fresh = !entry || entry.until <= now;
  identityFailures.set(participantId, { count: fresh ? 1 : entry.count + 1, until: fresh ? now + IDENTITY_LOCK_MS : entry.until });
  // keep the map bounded
  if (identityFailures.size > 5000) {
    for (const [id, e] of identityFailures) if (e.until <= now) identityFailures.delete(id);
  }
}

export function clearIdentityFailures(participantId: string) {
  identityFailures.delete(participantId);
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
