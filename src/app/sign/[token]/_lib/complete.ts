import "server-only";

import { after } from "next/server";

import { appUrl, sendMail } from "@/lib/email/mailer";
import { completedEmail, signRequestEmail } from "@/lib/email/templates";
import { logEvent, type EventType } from "@/lib/events";
import { finalizeDocument, type FinalizeResult } from "@/lib/pdf/finalize";
import type { DocumentCc, Participant } from "@/lib/types";

import { expiresAtFrom, isDone, safePdfName, type SignContext } from "./server";

/**
 * What happens after a participant finished their part (signed / viewed):
 *  - every participant done → document `completed` (+ completed event, final PDF, completion mails)
 *  - sequential order → the next `waiting` participant becomes `pending` and gets the request mail
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function safeLog(
  documentId: string,
  type: EventType,
  actor: { name?: string | null; email?: string | null },
  opts: { auto?: boolean; meta?: Record<string, unknown> } = {},
) {
  try {
    await logEvent(documentId, type, actor, opts);
  } catch (e) {
    console.error(`[sign] event ${type} could not be logged:`, (e as Error).message);
  }
}

function signerList(parts: Participant[]) {
  return parts.map((p) => ({ name: p.name, email: p.delivery === "email" ? p.email : null }));
}

async function sendToNext(ctx: SignContext, next: Participant, parts: Participant[]) {
  const { admin, doc, owner } = ctx;
  const now = new Date();
  const expiresAt = expiresAtFrom(doc.expires_days, now);
  const { data: claimed } = await admin
    .from("participants")
    .update({ status: "pending", sent_at: now.toISOString(), expires_at: expiresAt })
    .eq("id", next.id)
    .eq("status", "waiting")
    .select("id");
  if (!claimed?.length) return; // another request already moved the turn on

  await safeLog(doc.id, "sent", { name: next.name, email: next.email }, { auto: true, meta: { participant_id: next.id, delivery: next.delivery } });
  if (next.delivery !== "email" || !next.email) return;
  const mail = signRequestEmail({
    title: doc.title,
    requesterName: owner?.name ?? "요청자",
    requesterEmail: owner?.email ?? "",
    signerName: next.name,
    signers: signerList(parts),
    expiresAt,
    link: appUrl(`/sign/${next.access_token}`),
    message: next.message,
    view: doc.request_type === "view",
  });
  await sendMail({ to: next.email, toName: next.name, subject: mail.subject, html: mail.html, kind: "sign_request", documentId: doc.id });
}

async function sendCompletionMails(ctx: SignContext, parts: Participant[], completedAt: string, result: FinalizeResult | null) {
  const { doc, owner } = ctx;
  const attachments = result
    ? [
        { filename: safePdfName(doc.title), content: result.completedBytes },
        { filename: "감사 추적 인증서.pdf", content: result.auditBytes },
      ]
    : undefined;
  const signers = signerList(parts);
  const sent = new Set<string>();

  const send = async (to: string | null | undefined, name: string | null, link: string) => {
    const email = (to ?? "").trim();
    if (!EMAIL_RE.test(email) || sent.has(email.toLowerCase())) return;
    sent.add(email.toLowerCase());
    const mail = completedEmail({
      title: doc.title,
      requesterName: owner?.name ?? "요청자",
      signers,
      completedAt,
      link,
      documentId: doc.id,
      hash: result?.hash ?? null,
    });
    await sendMail({ to: email, toName: name, subject: mail.subject, html: mail.html, kind: "completed", documentId: doc.id, attachments });
  };

  // requester first: an employee who is also a participant gets the workspace link
  const docLink = appUrl(`/workspaces/${doc.workspace_id}/documents/${doc.id}`);
  await send(owner?.email, owner?.name ?? null, docLink);
  for (const p of parts) await send(p.email, p.name, appUrl(`/sign/${p.access_token}`));
  const cc = (Array.isArray(doc.cc) ? doc.cc : []) as DocumentCc[];
  for (const c of cc) await send(c?.email, c?.name || null, docLink);
}

async function completeDocument(ctx: SignContext, parts: Participant[]) {
  const { admin, doc } = ctx;
  const completedAt = new Date().toISOString();
  const { data: claimed } = await admin
    .from("documents")
    .update({ status: "completed", completed_at: completedAt, last_activity_at: completedAt })
    .eq("id", doc.id)
    .eq("status", "in_progress")
    .select("id");
  if (!claimed?.length) return false; // completed (or cancelled) by a concurrent request

  await safeLog(doc.id, "completed", { name: null, email: null }, { auto: true });

  let result: FinalizeResult | null = null;
  try {
    result = await finalizeDocument(doc.id);
  } catch (e) {
    // the download route retries the generation on demand
    console.error(`[sign] completed PDF of ${doc.id} could not be generated:`, (e as Error).message);
  }
  // mails carry two PDF attachments each — send them after the response so the signer is not kept waiting
  after(() => sendCompletionMails(ctx, parts, completedAt, result));
  return true;
}

/** Call after `ctx.me` was marked signed / viewed. Returns whether the document is now completed. */
export async function afterParticipantDone(ctx: SignContext): Promise<{ completed: boolean }> {
  const { admin, doc } = ctx;
  const { data } = await admin.from("participants").select("*").eq("document_id", doc.id).order("order_index");
  const parts = (data ?? []) as Participant[];
  await admin.from("documents").update({ last_activity_at: new Date().toISOString() }).eq("id", doc.id).eq("status", "in_progress");

  if (parts.length > 0 && parts.every((p) => isDone(p, doc.request_type))) {
    // false when a concurrent request completed it first — the document is completed either way
    await completeDocument(ctx, parts);
    return { completed: true };
  }

  if (doc.signing_order === "sequential" && !parts.some((p) => p.status === "pending")) {
    const next = parts.find((p) => p.status === "waiting");
    if (next) await sendToNext(ctx, next, parts);
  }
  return { completed: false };
}
