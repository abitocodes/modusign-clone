import "server-only";

import { appUrl, sendMail } from "@/lib/email/mailer";
import { emailLayout, koreanDeadline, maskEmail, signRequestEmail } from "@/lib/email/templates";
import { logEvent, type EventType } from "@/lib/events";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { DocStatus, DocumentCc, DocumentRow, FieldRow, Participant, Profile } from "@/lib/types";

/**
 * Sign-request send pipeline (cross-area contract, see CLAUDE.md).
 *
 * NOT a server action — only server code can call it. Callers must have authorised the request;
 * as defence in depth, when a user session exists it must belong to a member of the document's
 * workspace (unless `trusted` is passed by an internal caller that authorised by other means).
 */

export type SendResult = { ok: true } | { ok: false; error: string };

export interface SendOptions {
  /** who started the request (audit trail "created" event). Defaults to the document owner. */
  actor?: { name: string; email: string };
  /** internal callers that already authorised the request (e.g. scheduled dispatch, token flows) */
  trusted?: boolean;
  /** scheduled dispatch: log the "created" event as an automatic step (no IP) */
  automatic?: boolean;
}

/** statuses a document can be sent from */
const SENDABLE: DocStatus[] = ["draft", "on_modifying", "scheduled"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

const fail = (error: string): SendResult => ({ ok: false, error });

async function sessionUserId(): Promise<{ id: string | null; supabase: Awaited<ReturnType<typeof createClient>> | null }> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return { id: user?.id ?? null, supabase };
  } catch {
    // outside a request scope (no cookies) — treat as a server-internal call
    return { id: null, supabase: null };
  }
}

/** null = allowed, otherwise an error message */
async function authorise(workspaceId: string, trusted?: boolean): Promise<string | null> {
  if (trusted) return null;
  const { id, supabase } = await sessionUserId();
  if (!id || !supabase) return null; // server-internal call: the caller is responsible (contract)
  const { data } = await supabase
    .from("workspace_members")
    .select("user_id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", id)
    .maybeSingle();
  return data ? null : "이 문서를 전송할 권한이 없습니다.";
}

/**
 * Checks that a document is complete enough to be sent. Returns an error message or null.
 * (file, ≥1 participant, names, delivery + contact, ≥1 field per signer for sign requests)
 */
export function checkSendable(
  doc: Pick<DocumentRow, "file_path" | "request_type" | "expires_days" | "title">,
  participants: Pick<Participant, "id" | "name" | "email" | "phone" | "delivery" | "role">[],
  fields: Pick<FieldRow, "participant_id">[],
): string | null {
  if (!doc.file_path) return "문서 파일이 없습니다. 문서를 다시 업로드해 주세요.";
  if (!doc.title.trim()) return "문서 제목을 입력해 주세요.";
  if (!Number.isInteger(doc.expires_days) || doc.expires_days < 1 || doc.expires_days > 365)
    return "서명 유효 기한은 1일에서 365일 사이로 입력해 주세요.";
  const who = doc.request_type === "view" ? "열람자" : "서명자";
  if (participants.length === 0) return `${who}를 1명 이상 추가해 주세요.`;
  if (participants.length > 30) return `${who}는 최대 30명까지 지정할 수 있습니다.`;

  const emails = new Set<string>();
  for (const p of participants) {
    const name = p.name.trim();
    if (!name) return `이름을 입력하지 않은 ${who}가 있습니다.`;
    if (!p.delivery) return `${name}님의 전송 수단을 선택해 주세요.`;
    if (p.delivery === "kakao") return "카카오톡 전송은 준비 중입니다. 다른 전송 수단을 선택해 주세요.";
    if (p.delivery === "email") {
      const email = (p.email ?? "").trim().toLowerCase();
      if (!EMAIL_RE.test(email)) return `${name}님의 이메일 주소를 확인해 주세요.`;
      if (emails.has(email)) return `같은 이메일 주소(${email})를 가진 ${who}가 있습니다.`;
      emails.add(email);
    }
  }

  if (doc.request_type === "sign") {
    const withFields = new Set(fields.map((f) => f.participant_id).filter(Boolean));
    const missing = participants.filter((p) => p.role !== "viewer" && !withFields.has(p.id));
    if (missing.length > 0) return "모든 서명자에게 서명 입력란을 1개 이상 배치해 주세요.";
  }
  return null;
}

async function loadSendData(documentId: string) {
  const admin = createAdminClient();
  const { data: doc } = await admin.from("documents").select("*").eq("id", documentId).maybeSingle();
  if (!doc) return null;
  const [{ data: participants }, { data: fields }, { data: owner }] = await Promise.all([
    admin.from("participants").select("*").eq("document_id", documentId).order("order_index"),
    admin.from("fields").select("id, participant_id").eq("document_id", documentId),
    admin.from("profiles").select("*").eq("id", (doc as DocumentRow).owner_id).maybeSingle(),
  ]);
  return {
    admin,
    doc: doc as DocumentRow,
    participants: (participants ?? []) as Participant[],
    fields: (fields ?? []) as Pick<FieldRow, "id" | "participant_id">[],
    owner: (owner ?? null) as Profile | null,
  };
}

/**
 * Validation only (used before scheduling). Authorises like `sendDocument`.
 * Returns an error message or null when the document can be sent.
 */
export async function validateDocumentForSend(documentId: string, opts: Pick<SendOptions, "trusted"> = {}): Promise<string | null> {
  const data = await loadSendData(documentId);
  if (!data) return "문서를 찾을 수 없습니다.";
  const authError = await authorise(data.doc.workspace_id, opts.trusted);
  if (authError) return authError;
  if (!SENDABLE.includes(data.doc.status)) return "이미 전송되었거나 전송할 수 없는 상태의 문서입니다.";
  return checkSendable(data.doc, data.participants, data.fields);
}

async function safeLog(
  documentId: string,
  type: EventType,
  actor: { name?: string | null; email?: string | null },
  opts: { auto?: boolean; meta?: Record<string, unknown> },
) {
  try {
    await logEvent(documentId, type, actor, opts);
  } catch {
    // headers() unavailable outside a request — record without IP
    try {
      await logEvent(documentId, type, actor, { ...opts, auto: true });
    } catch (e) {
      console.error("[send] event log failed:", (e as Error).message);
    }
  }
}

function ccStartEmail(p: {
  title: string;
  requesterName: string;
  requesterEmail: string;
  signers: { name: string; email: string | null }[];
  requestedAt: string;
  view: boolean;
}) {
  const verb = p.view ? "열람" : "서명";
  return {
    subject: `[참조] '${p.title}' 문서의 ${verb} 요청이 시작되었습니다.`,
    html: emailLayout({
      heading: `${verb} 요청이 시작되었습니다.`,
      lead: [
        `${p.requesterName}님이 회원님을 이 문서의 참조자로 지정했습니다.`,
        `모든 참여자의 ${verb}이 완료되면 완료 문서를 이메일로 보내 드립니다.`,
      ],
      rows: [
        { label: "문서 제목", value: [p.title] },
        { label: `${verb} 요청자`, value: [`${p.requesterName}${p.requesterEmail ? ` (${p.requesterEmail})` : ""}`] },
        { label: p.view ? "열람자" : "서명자", value: p.signers.map((s) => `${s.name}${s.email ? ` (${maskEmail(s.email)})` : ""}`) },
        { label: "요청 일시", value: [koreanDeadline(p.requestedAt)] },
      ],
    }),
  };
}

/**
 * Sends a draft / scheduled document:
 *  - validates (file, participants, contact info, ≥1 field per signer)
 *  - document → in_progress (+ requested_at, last_activity_at), atomically (no double send)
 *  - participants: sequential → first `pending`, rest `waiting`; parallel → all `pending`
 *    (pending ones get sent_at and expires_at = now + expires_days)
 *  - audit trail: `created` (requester, with IP) then `sent` per pending participant (자동 진행)
 *  - e-mails every pending e-mail participant with `signRequestEmail` → appUrl('/sign/'+access_token)
 *    (직접 대면 participants get no mail); CC recipients get a start notice
 */
export async function sendDocument(documentId: string, opts: SendOptions = {}): Promise<SendResult> {
  const data = await loadSendData(documentId);
  if (!data) return fail("문서를 찾을 수 없습니다.");
  const { admin, doc, participants, fields, owner } = data;

  const authError = await authorise(doc.workspace_id, opts.trusted);
  if (authError) return fail(authError);
  if (!SENDABLE.includes(doc.status)) return fail("이미 전송되었거나 전송할 수 없는 상태의 문서입니다.");

  const invalid = checkSendable(doc, participants, fields);
  if (invalid) return fail(invalid);

  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + doc.expires_days * DAY_MS).toISOString();

  // Claim the document atomically: only one caller can move it out of its current status.
  const { data: claimed, error: claimError } = await admin
    .from("documents")
    .update({
      status: "in_progress",
      requested_at: nowIso,
      last_activity_at: nowIso,
      completed_at: null,
      // a stale 예약 time (e.g. a scheduled request reopened with 수정) no longer applies
      ...(doc.status === "scheduled" ? {} : { scheduled_at: null }),
    })
    .eq("id", doc.id)
    .eq("status", doc.status)
    .select("id");
  if (claimError) return fail("문서를 전송하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  if (!claimed || claimed.length === 0) return fail("이미 전송된 문서입니다.");

  const ordered = [...participants].sort((a, b) => a.order_index - b.order_index);
  const sequential = doc.signing_order === "sequential";
  const pending = sequential ? ordered.slice(0, 1) : ordered;
  const pendingIds = new Set(pending.map((p) => p.id));
  const role = doc.request_type === "view" ? "viewer" : "signer";

  const results = await Promise.all(
    ordered.map((p) =>
      admin
        .from("participants")
        .update(
          pendingIds.has(p.id)
            ? { status: "pending", role, sent_at: nowIso, expires_at: expiresAt, viewed_at: null, signed_at: null, reject_reason: null }
            : { status: "waiting", role, sent_at: null, expires_at: null, viewed_at: null, signed_at: null, reject_reason: null },
        )
        .eq("id", p.id),
    ),
  );
  if (results.some((r) => r.error)) {
    // roll the document back so the requester can retry
    await admin
      .from("documents")
      .update({ status: doc.status, requested_at: doc.requested_at, scheduled_at: doc.scheduled_at })
      .eq("id", doc.id);
    return fail("참여자 정보를 갱신하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }

  const requester = { name: owner?.name ?? "요청자", email: owner?.email ?? "" };
  const actor = opts.actor ?? requester;
  await safeLog(doc.id, "created", actor, { auto: !!opts.automatic, meta: opts.automatic ? { scheduled: true } : {} });

  const signers = ordered.map((p) => ({ name: p.name, email: p.delivery === "email" ? p.email : null }));
  const view = doc.request_type === "view";

  for (const p of pending) {
    await safeLog(doc.id, "sent", { name: p.name, email: p.email }, { auto: true, meta: { participant_id: p.id, delivery: p.delivery } });
    if (p.delivery !== "email" || !p.email) continue;
    const mail = signRequestEmail({
      title: doc.title,
      requesterName: requester.name,
      requesterEmail: requester.email,
      signerName: p.name,
      signers,
      expiresAt,
      link: appUrl(`/sign/${p.access_token}`),
      message: p.message,
      view,
    });
    await sendMail({ to: p.email, toName: p.name, subject: mail.subject, html: mail.html, kind: "sign_request", documentId: doc.id });
  }

  const cc = (Array.isArray(doc.cc) ? doc.cc : []) as DocumentCc[];
  for (const c of cc) {
    if (!c?.email || !EMAIL_RE.test(c.email)) continue;
    const mail = ccStartEmail({ title: doc.title, requesterName: requester.name, requesterEmail: requester.email, signers, requestedAt: nowIso, view });
    await sendMail({ to: c.email, toName: c.name || null, subject: mail.subject, html: mail.html, kind: "other", documentId: doc.id });
  }

  return { ok: true };
}

/**
 * Sends every `scheduled` document of the workspace whose `scheduled_at` has passed.
 * There is no cron — the 문서함 page calls this on load. Documents that became invalid
 * meanwhile are returned to 작성 중 (draft) so the requester can fix them.
 */
export async function dispatchScheduled(workspaceId: string): Promise<{ sent: number; failed: number }> {
  const authError = await authorise(workspaceId);
  if (authError) return { sent: 0, failed: 0 };

  const admin = createAdminClient();
  const { data: due } = await admin
    .from("documents")
    .select("id, owner_id")
    .eq("workspace_id", workspaceId)
    .eq("status", "scheduled")
    .lte("scheduled_at", new Date().toISOString())
    .order("scheduled_at")
    .limit(50);

  let sent = 0;
  let failed = 0;
  for (const d of due ?? []) {
    const res = await sendDocument(d.id, { trusted: true, automatic: true });
    if (res.ok) {
      sent++;
      continue;
    }
    if (res.error === "이미 전송된 문서입니다.") continue; // dispatched concurrently by another request
    failed++;
    console.error(`[send] scheduled document ${d.id} could not be sent: ${res.error}`);
    await admin
      .from("documents")
      .update({ status: "draft", scheduled_at: null, last_activity_at: new Date().toISOString() })
      .eq("id", d.id)
      .eq("status", "scheduled");
  }
  return { sent, failed };
}
