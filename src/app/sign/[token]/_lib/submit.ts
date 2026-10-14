import "server-only";

import { revalidatePath } from "next/cache";

import { checkImageDataUrl } from "@/lib/images";
import type { FieldRow } from "@/lib/types";

import { afterParticipantDone, safeLog } from "./complete";
import { isExpired, seoulDay, type SignContext } from "./server";
import type { ActionResult } from "./types";
import { fieldError, fieldLabel, hasValue, isManual, maxValueLength, normalizeSentence } from "./validate";

/**
 * Shared steps of the signer server actions (../actions.ts). Callers authorise first: the public
 * actions check the link, the document / participant state and the identity cookie
 * (`loadActive`); nothing in here re-checks the identity.
 */

const fail = (error: string) => ({ ok: false as const, error });
const MAX_TOTAL_VALUES = 10_000_000;

export function revalidateSign(ctx: SignContext) {
  revalidatePath(`/sign/${ctx.me.access_token}`);
  revalidatePath(`/workspaces/${ctx.doc.workspace_id}`, "layout");
}

export function docStateError(ctx: SignContext): string | null {
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

export function participantStateError(ctx: SignContext): string | null {
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
export function claimError(verdict: unknown): string {
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

export const myFields = (ctx: SignContext) => ctx.fields.filter((f) => f.participant_id === ctx.me.id);

/** keeps only string values of my own manual fields, bounded in size per field type */
export function sanitizeValues(fields: FieldRow[], input: unknown): Record<string, string> | string {
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

/**
 * 동의하고 서명합니다 (or 열람 완료) for an authorised participant whose turn it is: validates every
 * one of their fields, stores the values, marks them signed / viewed, then moves the request on
 * (next signer or completion).
 */
export async function submitForParticipant(ctx: SignContext, values: Record<string, string>): Promise<ActionResult<{ completed: boolean }>> {
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
