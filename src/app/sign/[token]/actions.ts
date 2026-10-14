"use server";

import { revalidatePath } from "next/cache";

import { appUrl, sendMail } from "@/lib/email/mailer";
import { rejectedEmail } from "@/lib/email/templates";
import { checkImageDataUrl } from "@/lib/images";
import type { FieldRow } from "@/lib/types";

import { afterParticipantDone, safeLog } from "./_lib/complete";
import {
  clearIdentityFailures,
  identityCheck,
  identityLock,
  isExpired,
  isVerified,
  loadSignContext,
  lockMessage,
  recordIdentityFailure,
  safeEqual,
  seoulDay,
  setVerifiedCookie,
  type SignContext,
} from "./_lib/server";
import type { ActionResult } from "./_lib/types";
import {
  fieldError,
  fieldLabel,
  hasValue,
  isManual,
  MAX_REJECT_REASON,
  maxValueLength,
  normalizeSentence,
} from "./_lib/validate";

/**
 * Server actions of the public signer page. Each one re-loads the participant by its access token,
 * re-checks the document / participant state and the identity cookie before writing anything
 * with the service role.
 */

const fail = (error: string) => ({ ok: false as const, error });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MAX_TOTAL_VALUES = 10_000_000;

function revalidateSign(ctx: SignContext) {
  revalidatePath(`/sign/${ctx.me.access_token}`);
  revalidatePath(`/workspaces/${ctx.doc.workspace_id}`, "layout");
}

function docStateError(ctx: SignContext): string | null {
  switch (ctx.doc.status) {
    case "in_progress":
      return null;
    case "completed":
      return "이미 서명이 완료된 문서입니다.";
    case "rejected":
      return "서명이 거절된 문서입니다.";
    case "request_cancelled":
      return "서명 요청이 취소된 문서입니다.";
    case "signing_cancelled":
      return "서명이 취소된 문서입니다.";
    default:
      return "아직 서명 요청이 전송되지 않은 문서입니다.";
  }
}

function participantStateError(ctx: SignContext): string | null {
  switch (ctx.me.status) {
    case "pending":
      return isExpired(ctx.me) ? "서명 기한이 만료되었습니다." : null;
    case "waiting":
      return "아직 서명 차례가 아닙니다.";
    case "rejected":
      return "서명을 거절한 문서입니다.";
    default:
      return "이미 서명을 완료했습니다.";
  }
}

/** message for a verdict of the sign_submit / sign_reject RPCs other than 'ok' */
function claimError(verdict: unknown): string {
  switch (verdict) {
    case "doc_state":
      return "문서 상태가 변경되어 처리할 수 없습니다. 페이지를 새로고침해 주세요.";
    case "expired":
      return "서명 기한이 만료되었습니다.";
    case "not_found":
      return "유효하지 않은 서명 링크입니다.";
    default:
      return "이미 처리된 서명입니다. 페이지를 새로고침해 주세요.";
  }
}

/** loads the context and checks: link valid, document in progress, my turn, not expired, verified */
async function loadActive(token: unknown): Promise<SignContext | string> {
  if (typeof token !== "string") return "유효하지 않은 서명 링크입니다.";
  const ctx = await loadSignContext(token);
  if (!ctx) return "유효하지 않은 서명 링크입니다.";
  const err = docStateError(ctx) ?? participantStateError(ctx);
  if (err) return err;
  if (!(await isVerified(ctx.me))) return "본인 확인이 필요합니다. 페이지를 새로고침해 주세요.";
  return ctx;
}

const myFields = (ctx: SignContext) => ctx.fields.filter((f) => f.participant_id === ctx.me.id);

/** keeps only string values of my own manual fields, bounded in size per field type */
function sanitizeValues(fields: FieldRow[], input: unknown): Record<string, string> | string {
  if (!input || typeof input !== "object" || Array.isArray(input)) return "잘못된 요청입니다.";
  const raw = input as Record<string, unknown>;
  const out: Record<string, string> = {};
  let total = 0;
  for (const f of fields) {
    if (!isManual(f)) continue;
    const v = raw[f.id];
    if (v == null) continue;
    if (typeof v !== "string") return "잘못된 입력값이 있습니다.";
    // typed values may still carry whitespace that is trimmed / collapsed when signing
    const cap = f.type === "signature" || f.type === "image" ? maxValueLength(f.type) : maxValueLength(f.type) * 2;
    if (v.length > cap) return `${fieldLabel(f)}: 용량이 너무 큽니다.`;
    total += v.length;
    out[f.id] = f.type === "signature" || f.type === "image" || f.type === "transcribe" ? v : v.replace(/\r?\n/g, " ");
  }
  if (total > MAX_TOTAL_VALUES) return "입력한 내용의 용량이 너무 큽니다.";
  return out;
}

/* ---------------------------------------------------------------- identity */

export type VerifyResult = { ok: true } | { ok: false; error: string; field?: "email" | "phone" | "password" };

/** 본인 확인: invited e-mail (or the last 4 digits of the phone) + optional 인증 비밀번호. */
export async function verifyIdentity(
  token: string,
  input: { email?: string; phone?: string; password?: string },
): Promise<VerifyResult> {
  if (typeof token !== "string" || !input || typeof input !== "object") return fail("잘못된 요청입니다.");
  const ctx = await loadSignContext(token);
  if (!ctx) return fail("유효하지 않은 서명 링크입니다.");
  if (["draft", "on_modifying", "scheduled"].includes(ctx.doc.status)) return fail("아직 서명 요청이 전송되지 않은 문서입니다.");
  if (ctx.me.status === "waiting") return fail("아직 서명 차례가 아닙니다.");

  const check = identityCheck(ctx.me);
  // 직접 대면: there is nothing to verify (isVerified accepts it) — never issue a cookie for it, so
  // switching the participant to e-mail later cannot reuse a check that never happened
  if (check === null) return { ok: true };

  const locked = await identityLock(ctx.admin, ctx.me.id);
  if (locked) {
    await sleep(400);
    return fail(lockMessage(locked));
  }

  const wrong = async (field: "email" | "phone" | "password", error: string): Promise<VerifyResult> => {
    const lock = await recordIdentityFailure(ctx.admin, ctx.me.id);
    await sleep(400);
    if (lock?.permanent) {
      await safeLog(ctx.doc.id, "identity_locked", { name: ctx.me.name, email: ctx.me.email }, { meta: { participant_id: ctx.me.id } });
    }
    return { ok: false, field, error: lock ? `${error} ${lockMessage(lock)}` : error };
  };

  if (check === "email") {
    const typed = String(input.email ?? "").trim().toLowerCase();
    if (!typed || typed !== (ctx.me.email ?? "").trim().toLowerCase()) {
      return wrong("email", "서명 요청을 받은 이메일 주소와 일치하지 않습니다.");
    }
  } else if (check === "phone") {
    const typed = String(input.phone ?? "").replace(/\D/g, "");
    const last4 = (ctx.me.phone ?? "").replace(/\D/g, "").slice(-4);
    if (typed.length !== 4 || typed !== last4) {
      return wrong("phone", "서명 요청을 받은 휴대폰 번호와 일치하지 않습니다.");
    }
  }
  if (ctx.me.auth_password) {
    const typed = String(input.password ?? "");
    if (!typed || !safeEqual(typed, ctx.me.auth_password)) {
      return wrong("password", "비밀번호가 일치하지 않습니다.");
    }
  }

  await clearIdentityFailures(ctx.admin, ctx.me.id);
  try {
    await setVerifiedCookie(ctx.me);
  } catch (e) {
    console.error("[sign] identity cookie not issued:", (e as Error).message);
    return fail("본인 확인을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
  revalidatePath(`/sign/${ctx.me.access_token}`);
  return { ok: true };
}

/* ------------------------------------------------------------------ viewed */

/** First display of the document after the identity check → viewed_at + "viewed" event (sign requests). */
export async function markViewed(token: string): Promise<ActionResult> {
  const ctx = await loadActive(token);
  if (typeof ctx === "string") return fail(ctx);
  if (ctx.me.viewed_at) return { ok: true };
  const now = new Date().toISOString();
  const { data: claimed } = await ctx.admin
    .from("participants")
    .update({ viewed_at: now })
    .eq("id", ctx.me.id)
    .is("viewed_at", null)
    .select("id");
  if (claimed?.length && ctx.doc.request_type === "sign") {
    await safeLog(ctx.doc.id, "viewed", { name: ctx.me.name, email: ctx.me.email }, { meta: { participant_id: ctx.me.id } });
    await ctx.admin.from("documents").update({ last_activity_at: now }).eq("id", ctx.doc.id);
    revalidatePath(`/workspaces/${ctx.doc.workspace_id}/esign/documents/documents`);
  }
  return { ok: true };
}

/* ------------------------------------------------------------------- draft */

/** 임시저장: keeps my values without signing (participants.draft_values). */
export async function saveDraft(token: string, values: Record<string, string>): Promise<ActionResult> {
  const ctx = await loadActive(token);
  if (typeof ctx === "string") return fail(ctx);
  const clean = sanitizeValues(myFields(ctx), values);
  if (typeof clean === "string") return fail(clean);
  const { error } = await ctx.admin.from("participants").update({ draft_values: clean }).eq("id", ctx.me.id).eq("status", "pending");
  if (error) return fail("임시저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  revalidatePath(`/sign/${ctx.me.access_token}`);
  return { ok: true };
}

/* ------------------------------------------------------------------ submit */

/**
 * 동의하고 서명합니다 (or 열람 완료 for view requests): validates every one of my fields, stores the
 * values, marks me signed / viewed, then moves the request on (next signer or completion).
 */
export async function submitSignature(token: string, values: Record<string, string>): Promise<ActionResult<{ completed: boolean }>> {
  const ctx = await loadActive(token);
  if (typeof ctx === "string") return fail(ctx);
  const { admin, me, doc } = ctx;
  const view = doc.request_type === "view";
  const fields = myFields(ctx);
  const clean = sanitizeValues(fields, values);
  if (typeof clean === "string") return fail(clean);

  const today = seoulDay();
  const finalValues: { field: FieldRow; value: string }[] = [];
  for (const f of fields) {
    const raw = f.type === "signed_date" ? today : (clean[f.id] ?? "");
    // stored as shown on the page: trimmed text, 따라쓰기 with single spaces
    const value = f.type === "text" ? raw.trim() : f.type === "transcribe" ? normalizeSentence(raw) : raw;
    const err = fieldError(f, value);
    if (err) return fail(`${fieldLabel(f)}: ${err}`);
    if (f.type === "signature" || f.type === "image") {
      const imageErr = hasValue(f, value) ? checkImageDataUrl(value) : null;
      if (imageErr) return fail(`${fieldLabel(f)}: ${imageErr}`);
    }
    if (hasValue(f, value) || f.type === "checkbox") finalValues.push({ field: f, value: f.type === "checkbox" ? (value === "true" ? "true" : "") : value });
  }

  const now = new Date().toISOString();

  // the document is displayed before anyone can sign — make sure "viewed" precedes "signed"
  if (!me.viewed_at) {
    const { data: claimed } = await admin.from("participants").update({ viewed_at: now }).eq("id", me.id).is("viewed_at", null).select("id");
    if (claimed?.length && !view) await safeLog(doc.id, "viewed", { name: me.name, email: me.email }, { meta: { participant_id: me.id } });
  }

  // one transaction, serialised on the document row: document still in progress, my turn, not
  // expired → my values (the ones submitted now, always overwritten) + me signed / viewed
  const { data: verdict, error: submitError } = await admin.rpc("sign_submit", {
    p_participant_id: me.id,
    p_values: Object.fromEntries(finalValues.map(({ field, value }) => [field.id, value])),
    p_view: view,
  });
  if (submitError) {
    console.error("[sign] submit failed:", submitError.message);
    return fail("입력한 내용을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
  if (verdict !== "ok") return fail(claimError(verdict));

  await safeLog(doc.id, view ? "viewed" : "signed", { name: me.name, email: me.email }, { meta: { participant_id: me.id } });

  const { completed } = await afterParticipantDone(ctx);
  revalidateSign(ctx);
  return { ok: true, data: { completed } };
}

/* ------------------------------------------------------------------ reject */

/** 서명 거절 with a reason → document rejected, requester notified. */
export async function rejectSignature(token: string, reason: string): Promise<ActionResult> {
  const ctx = await loadActive(token);
  if (typeof ctx === "string") return fail(ctx);
  const { admin, me, doc, owner } = ctx;
  if (doc.request_type === "view") return fail("열람 요청은 거절할 수 없습니다.");
  const text = typeof reason === "string" ? reason.trim() : "";
  if (!text) return fail("거절 사유를 입력해 주세요.");
  if (text.length > MAX_REJECT_REASON) return fail(`거절 사유는 ${MAX_REJECT_REASON}자 이내로 입력해 주세요.`);

  // participant rejected + document rejected in one transaction (only while it is in progress)
  const { data: verdict, error: rejectError } = await admin.rpc("sign_reject", { p_participant_id: me.id, p_reason: text });
  if (rejectError) {
    console.error("[sign] reject failed:", rejectError.message);
    return fail("서명을 거절하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
  if (verdict !== "ok") return fail(claimError(verdict));

  await safeLog(doc.id, "rejected", { name: me.name, email: me.email }, { meta: { reason: text, participant_id: me.id } });

  if (owner?.email) {
    const mail = rejectedEmail({
      title: doc.title,
      signerName: me.name,
      reason: text,
      link: appUrl(`/workspaces/${doc.workspace_id}/documents/${doc.id}`),
    });
    await sendMail({ to: owner.email, toName: owner.name, subject: mail.subject, html: mail.html, kind: "rejected", documentId: doc.id });
  }

  revalidateSign(ctx);
  return { ok: true };
}
