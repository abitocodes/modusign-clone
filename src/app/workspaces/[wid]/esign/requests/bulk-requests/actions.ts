"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { sendDocument } from "@/lib/server/send";
import { createClient } from "@/lib/supabase/server";
import {
  BULK_MAX_RECIPIENTS,
  BULK_TITLE_MAX,
  isUuid,
  validateRecipients,
  type BulkRecipientItem,
  type BulkSummary,
  type RecipientInput,
  type Result,
} from "@/lib/templates/model";
import {
  TEMPLATE_USE_COLUMNS,
  canManageTemplate,
  discardInstantiated,
  instantiateTemplate,
  memberRole,
  singleRoleTemplateIssue,
  type TemplateForUse,
} from "@/lib/templates/server";
import type { BulkSend, MemberRole, TemplateRow } from "@/lib/types";

/** recipients processed per call (the browser keeps calling until the batch is done) */
const CHUNK = 5;

type Supabase = Awaited<ReturnType<typeof createClient>>;
type Auth = { ok: true; supabase: Supabase; userId: string; role: MemberRole } | { ok: false; error: string };

async function authorize(wid: unknown): Promise<Auth> {
  if (!isUuid(wid)) return { ok: false, error: "잘못된 요청입니다." };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다. 다시 로그인해 주세요." };
  const role = await memberRole(supabase, wid, user.id);
  if (!role) return { ok: false, error: "이 워크스페이스에 접근할 권한이 없습니다." };
  return { ok: true, supabase, userId: user.id, role };
}

function revalidateBulk(wid: string) {
  revalidatePath(`/workspaces/${wid}/esign/requests/bulk-requests`);
  revalidatePath(`/workspaces/${wid}/esign/documents/documents`);
}

const templateIssue = (t: TemplateForUse) => singleRoleTemplateIssue(t, "대량전송");

export interface CreateBulkInput {
  templateId: string;
  title: string;
  recipients: RecipientInput[];
}

/** 템플릿으로 대량전송: validates and stores the batch (status sending). Sending happens in processBulkSend. */
export async function createBulkSend(wid: string, input: CreateBulkInput): Promise<Result<{ id: string; total: number }>> {
  const auth = await authorize(wid);
  if (!auth.ok) return auth;
  if (!input || !isUuid(input.templateId)) return { ok: false, error: "템플릿을 선택해 주세요." };

  const title = typeof input.title === "string" ? input.title.trim().replace(/\s+/g, " ") : "";
  if (!title) return { ok: false, error: "대량전송 제목을 입력해 주세요." };
  if (title.length > BULK_TITLE_MAX) return { ok: false, error: `대량전송 제목은 ${BULK_TITLE_MAX}자 이내로 입력해 주세요.` };

  const raw = Array.isArray(input.recipients) ? input.recipients : [];
  if (raw.length === 0) return { ok: false, error: "수신자를 1명 이상 추가해 주세요." };
  if (raw.length > BULK_MAX_RECIPIENTS) return { ok: false, error: `수신자는 한 번에 최대 ${BULK_MAX_RECIPIENTS}명까지 보낼 수 있습니다.` };
  const rows = validateRecipients(
    raw.map((r) => ({ name: typeof r?.name === "string" ? r.name : "", email: typeof r?.email === "string" ? r.email : "" })),
  );
  const bad = rows.find((r) => r.error);
  if (bad) return { ok: false, error: `${bad.line}번째 수신자: ${bad.error}` };

  const { data } = await auth.supabase.from("templates").select(TEMPLATE_USE_COLUMNS).eq("id", input.templateId).eq("workspace_id", wid).maybeSingle();
  const template = data as TemplateForUse | null;
  if (!template) return { ok: false, error: "템플릿을 찾을 수 없거나 사용할 권한이 없습니다." };
  const issue = templateIssue(template);
  if (issue) return { ok: false, error: issue };

  const id = randomUUID();
  const recipients: BulkRecipientItem[] = rows.map((r) => ({
    name: r.name.trim().replace(/\s+/g, " "),
    email: r.email.trim().toLowerCase(),
    status: "pending",
    document_id: null,
    error: null,
  }));
  const { error } = await auth.supabase.from("bulk_sends").insert({
    id,
    workspace_id: wid,
    owner_id: auth.userId,
    template_id: template.id,
    title,
    status: "sending",
    recipients,
  });
  if (error) return { ok: false, error: "대량전송을 만들지 못했습니다. 잠시 후 다시 시도해 주세요." };

  revalidatePath(`/workspaces/${wid}/esign/requests/bulk-requests`);
  return { ok: true, id, total: recipients.length };
}

const toSummary = (v: unknown): BulkSummary => {
  const o = (v ?? {}) as Partial<BulkSummary>;
  return {
    status: o.status ?? "sending",
    total: Number(o.total) || 0,
    sent: Number(o.sent) || 0,
    failed: Number(o.failed) || 0,
    pending: Number(o.pending) || 0,
    processing: Number(o.processing) || 0,
  };
};

/**
 * Sends the next few recipients of a batch: claims them atomically (bulk_send_claim), creates a
 * document from the template for each (participant filled in), sends it with sendDocument and
 * stores the result (bulk_send_report). Returns the batch summary; call again while pending > 0.
 */
export async function processBulkSend(wid: string, bulkId: string): Promise<Result<{ summary: BulkSummary }>> {
  const auth = await authorize(wid);
  if (!auth.ok) return auth;
  if (!isUuid(bulkId)) return { ok: false, error: "잘못된 요청입니다." };
  const { supabase } = auth;

  const { data } = await supabase
    .from("bulk_sends")
    .select("id, workspace_id, owner_id, template_id, title, status")
    .eq("id", bulkId)
    .eq("workspace_id", wid)
    .maybeSingle();
  const bulk = data as Pick<BulkSend, "id" | "workspace_id" | "owner_id" | "template_id" | "title" | "status"> | null;
  if (!bulk) return { ok: false, error: "대량전송을 찾을 수 없습니다." };
  if (!canManageTemplate(bulk, auth.userId, auth.role)) return { ok: false, error: "대량전송을 만든 멤버나 관리자만 전송할 수 있습니다." };

  if (bulk.status !== "sending") {
    const { data: s, error } = await supabase.rpc("bulk_send_settle", { p_bulk_id: bulk.id });
    if (error) return { ok: false, error: "대량전송 상태를 불러오지 못했습니다." };
    return { ok: true, summary: toSummary(s) };
  }

  const { data: claimedData, error: claimErr } = await supabase.rpc("bulk_send_claim", { p_bulk_id: bulk.id, p_limit: CHUNK });
  if (claimErr) return { ok: false, error: "대량전송을 진행하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  const claimed = (Array.isArray(claimedData) ? claimedData : []) as { index: number; name: string; email: string }[];

  if (claimed.length > 0) {
    let template: TemplateForUse | null = null;
    if (bulk.template_id) {
      const { data: t } = await supabase.from("templates").select(TEMPLATE_USE_COLUMNS).eq("id", bulk.template_id).maybeSingle();
      template = (t as TemplateForUse | null) ?? null;
    }
    const issue = template ? templateIssue(template) : "템플릿을 찾을 수 없습니다. 삭제되었거나 공유가 해제되었습니다.";

    const results = await Promise.all(
      claimed.map(async (c) => {
        if (issue || !template) return { index: c.index, status: "failed", error: issue };
        try {
          const made = await instantiateTemplate({
            db: supabase,
            template,
            ownerId: auth.userId,
            title: bulk.title,
            people: [{ name: c.name, email: c.email }],
          });
          if (!made.ok) return { index: c.index, status: "failed", error: made.error };
          const sent = await sendDocument(made.documentId);
          if (!sent.ok) {
            await discardInstantiated(supabase, wid, made.documentId);
            return { index: c.index, status: "failed", error: sent.error };
          }
          return { index: c.index, status: "sent", document_id: made.documentId };
        } catch (e) {
          console.error("[bulk] recipient failed:", (e as Error).message);
          return { index: c.index, status: "failed", error: "전송 중 오류가 발생했습니다." };
        }
      }),
    );

    const { data: s, error: reportErr } = await supabase.rpc("bulk_send_report", { p_bulk_id: bulk.id, p_results: results });
    if (reportErr) return { ok: false, error: "전송 결과를 저장하지 못했습니다." };
    const summary = toSummary(s);
    if (summary.status !== "sending") revalidateBulk(wid);
    else revalidatePath(`/workspaces/${wid}/esign/requests/bulk-requests`);
    return { ok: true, summary };
  }

  const { data: s, error } = await supabase.rpc("bulk_send_settle", { p_bulk_id: bulk.id });
  if (error) return { ok: false, error: "대량전송 상태를 불러오지 못했습니다." };
  const summary = toSummary(s);
  if (summary.status !== "sending") revalidateBulk(wid);
  return { ok: true, summary };
}

export interface BulkDetail {
  id: string;
  title: string;
  status: BulkSend["status"];
  templateTitle: string | null;
  ownerName: string | null;
  canManage: boolean;
  createdAt: string;
  sentAt: string | null;
  recipients: BulkRecipientItem[];
}

/** 상세 보기: recipients with their result and document. */
export async function getBulkDetail(wid: string, bulkId: string): Promise<Result<{ detail: BulkDetail }>> {
  const auth = await authorize(wid);
  if (!auth.ok) return auth;
  if (!isUuid(bulkId)) return { ok: false, error: "잘못된 요청입니다." };
  const { data } = await auth.supabase.from("bulk_sends").select("*").eq("id", bulkId).eq("workspace_id", wid).maybeSingle();
  const bulk = data as (Omit<BulkSend, "recipients"> & { recipients: BulkRecipientItem[] }) | null;
  if (!bulk) return { ok: false, error: "대량전송을 찾을 수 없습니다." };

  const [{ data: t }, { data: owner }] = await Promise.all([
    bulk.template_id
      ? auth.supabase.from("templates").select("title").eq("id", bulk.template_id).maybeSingle()
      : Promise.resolve({ data: null }),
    auth.supabase.from("profiles").select("name").eq("id", bulk.owner_id).maybeSingle(),
  ]);

  return {
    ok: true,
    detail: {
      id: bulk.id,
      title: bulk.title,
      status: bulk.status,
      templateTitle: (t as Pick<TemplateRow, "title"> | null)?.title ?? null,
      ownerName: (owner as { name: string } | null)?.name ?? null,
      canManage: canManageTemplate(bulk, auth.userId, auth.role),
      createdAt: bulk.created_at,
      sentAt: bulk.sent_at,
      recipients: (Array.isArray(bulk.recipients) ? bulk.recipients : []).map((r) => ({
        name: r.name ?? "",
        email: r.email ?? "",
        status: r.status ?? "pending",
        document_id: r.document_id ?? null,
        error: r.error ?? null,
        processed_at: r.processed_at ?? null,
      })),
    },
  };
}

/** 삭제: removes the batch record only — documents that were already sent are kept. */
export async function deleteBulkSend(wid: string, bulkId: string): Promise<Result> {
  const auth = await authorize(wid);
  if (!auth.ok) return auth;
  if (!isUuid(bulkId)) return { ok: false, error: "잘못된 요청입니다." };
  const { data } = await auth.supabase.from("bulk_sends").select("id, owner_id").eq("id", bulkId).eq("workspace_id", wid).maybeSingle();
  const bulk = data as Pick<BulkSend, "id" | "owner_id"> | null;
  if (!bulk) return { ok: false, error: "대량전송을 찾을 수 없습니다." };
  if (!canManageTemplate(bulk, auth.userId, auth.role)) return { ok: false, error: "대량전송을 만든 멤버나 관리자만 삭제할 수 있습니다." };
  const { error } = await auth.supabase.from("bulk_sends").delete().eq("id", bulk.id);
  if (error) return { ok: false, error: "대량전송을 삭제하지 못했습니다." };
  revalidatePath(`/workspaces/${wid}/esign/requests/bulk-requests`);
  return { ok: true };
}
