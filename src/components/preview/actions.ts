"use server";

import { revalidatePath } from "next/cache";

import { docStateError, myFields, participantStateError, submitForParticipant } from "@/app/sign/[token]/_lib/submit";
import { loadSignContext, seoulDay, type SignContext } from "@/app/sign/[token]/_lib/server";
import { fieldError, initialValue, isManual } from "@/app/sign/[token]/_lib/validate";
import { canManage, getActor, isUuid } from "@/lib/documents/server";
import { PREVIEW } from "@/lib/preview/flag";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { DocStatus, ParticipantStatus, RequestType } from "@/lib/types";

import { previewFieldValue } from "./dummy-values";
import type { PreviewDocumentSigners, PreviewPendingList, PreviewResult, PreviewSignerLink } from "./types";

/**
 * Server actions of the preview mode (`npm run dev:preview`, mock backend — src/lib/preview/DESIGN.md).
 * Every action throws unless PREVIEW is on (always off in production builds and in `npm run dev`).
 * They use the normal app clients: in preview those are the in-memory mock.
 */

const NOT_FOUND = "문서를 찾을 수 없습니다.";
const NO_PERMISSION = "이 작업을 수행할 권한이 없습니다.";
const MAX_DOCS = 20;
/** upper bound of signer turns simulated for one document */
const MAX_TURNS = 50;
/** documents whose signer links lead to a real signer screen */
const SENT: DocStatus[] = ["in_progress", "completed", "rejected", "request_cancelled", "signing_cancelled"];

const fail = (error: string) => ({ ok: false as const, error });

function assertPreview() {
  if (!PREVIEW) throw new Error("Not found");
}

interface TokenRow {
  id: string;
  document_id: string;
  name: string;
  email: string | null;
  status: ParticipantStatus;
  order_index: number;
  access_token: string;
}

const toLink = (p: TokenRow): PreviewSignerLink => ({
  id: p.id,
  name: p.name || p.email || "서명자",
  email: p.email,
  status: p.status,
  href: `/sign/${p.access_token}`,
});

/* --------------------------------------------------------------- reset */

/** 데모 데이터 초기화: the platform's seed rebuilds the in-memory database. */
export async function resetPreviewData(): Promise<PreviewResult> {
  assertPreview();
  try {
    const mod = (await import("@/lib/preview/seed")) as { resetPreview?: () => unknown };
    if (typeof mod.resetPreview !== "function") return fail("데모 데이터를 초기화할 수 없습니다.");
    await mod.resetPreview();
  } catch (e) {
    console.error("[preview] reset failed:", (e as Error)?.message ?? e);
    return fail("데모 데이터를 초기화하지 못했습니다.");
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

/* ------------------------------------------------------- signer links */

/** In-progress documents of my workspaces + the participants whose turn it is (PreviewBadge). */
export async function listPendingSigners(): Promise<PreviewPendingList> {
  assertPreview();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { signedIn: false, docs: [] };

  const { data: members } = await supabase.from("workspace_members").select("workspace_id").eq("user_id", user.id);
  const wids = ((members ?? []) as { workspace_id: string }[]).map((m) => m.workspace_id);
  if (!wids.length) return { signedIn: true, docs: [] };

  // sign links are not readable with the user's session — the admin client reads them
  const admin = createAdminClient();
  const { data: docs } = await admin
    .from("documents")
    .select("id, title, workspace_id, request_type, requested_at")
    .in("workspace_id", wids)
    .eq("status", "in_progress")
    .order("requested_at", { ascending: false })
    .limit(MAX_DOCS);
  const rows = (docs ?? []) as { id: string; title: string; workspace_id: string; request_type: RequestType }[];
  if (!rows.length) return { signedIn: true, docs: [] };

  const { data: parts } = await admin
    .from("participants")
    .select("id, document_id, name, email, status, order_index, access_token")
    .in(
      "document_id",
      rows.map((d) => d.id),
    )
    .eq("status", "pending")
    .order("order_index");
  const byDoc = new Map<string, PreviewSignerLink[]>();
  for (const p of (parts ?? []) as TokenRow[]) byDoc.set(p.document_id, [...(byDoc.get(p.document_id) ?? []), toLink(p)]);

  return {
    signedIn: true,
    docs: rows
      .map((d) => ({ id: d.id, title: d.title, workspaceId: d.workspace_id, requestType: d.request_type, signers: byDoc.get(d.id) ?? [] }))
      .filter((d) => d.signers.length > 0),
  };
}

/** Every participant of a sent document with their signer link (members of the workspace). */
export async function listDocumentSigners(docId: string): Promise<PreviewResult<PreviewDocumentSigners>> {
  assertPreview();
  if (!isUuid(docId)) return fail(NOT_FOUND);
  const admin = createAdminClient();
  const { data } = await admin.from("documents").select("id, workspace_id, owner_id, status, request_type").eq("id", docId).maybeSingle();
  const doc = data as { id: string; workspace_id: string; owner_id: string; status: DocStatus; request_type: RequestType } | null;
  if (!doc) return fail(NOT_FOUND);
  const actor = await getActor(doc.workspace_id);
  if (!actor) return fail(NO_PERMISSION);

  const base = { status: doc.status, requestType: doc.request_type, workspaceId: doc.workspace_id };
  if (!SENT.includes(doc.status)) return { ok: true, ...base, canSimulate: false, signers: [] };

  const { data: parts } = await admin
    .from("participants")
    .select("id, document_id, name, email, status, order_index, access_token")
    .eq("document_id", doc.id)
    .order("order_index");
  return {
    ok: true,
    ...base,
    canSimulate: doc.status === "in_progress" && canManage(doc, actor),
    signers: ((parts ?? []) as TokenRow[]).map(toLink),
  };
}

/* ---------------------------------------------------- simulated signing */

/** Values a signer would submit: 임시저장 / 자동 입력 values, required fields filled with dummy values. */
function previewValues(ctx: SignContext): Record<string, string> {
  const draft = Object.fromEntries(
    Object.entries(ctx.me.draft_values ?? {}).filter((e): e is [string, string] => typeof e[1] === "string"),
  );
  const today = seoulDay();
  const out: Record<string, string> = {};
  for (const f of myFields(ctx)) {
    if (!isManual(f)) continue;
    const field = { type: f.type, required: f.required, options: f.options ?? {} };
    let value = initialValue(field, draft, f.id, ctx.me.name);
    if (fieldError(field, value)) {
      value = f.required ? previewFieldValue(field, { name: ctx.me.name, email: ctx.me.email, today }) : "";
    }
    if (value) out[f.id] = value;
  }
  return out;
}

/**
 * 모든 서명자 서명 완료 처리 (미리보기): every participant whose turn it is signs (or views) with dummy
 * values, in order — sequential requests advance turn by turn — through the same server-side
 * steps as the signer page (sign_submit, next signer / completion, completed PDF, audit
 * certificate, completion mails). Requester / workspace admins only.
 */
export async function simulatePreviewSigning(docId: string): Promise<PreviewResult<{ signed: number; completed: boolean }>> {
  assertPreview();
  if (!isUuid(docId)) return fail(NOT_FOUND);
  const admin = createAdminClient();
  const { data } = await admin.from("documents").select("id, workspace_id, owner_id, status").eq("id", docId).maybeSingle();
  const doc = data as { id: string; workspace_id: string; owner_id: string; status: DocStatus } | null;
  if (!doc) return fail(NOT_FOUND);
  const actor = await getActor(doc.workspace_id);
  if (!actor) return fail(NO_PERMISSION);
  if (!canManage(doc, actor)) return fail(NO_PERMISSION);
  if (doc.status !== "in_progress") return fail("진행 중인 문서만 서명 완료 처리할 수 있습니다.");

  let signed = 0;
  let completed = false;
  for (let turn = 0; turn < MAX_TURNS && !completed; turn++) {
    const { data: parts } = await admin
      .from("participants")
      .select("id, status, order_index, access_token")
      .eq("document_id", doc.id)
      .order("order_index");
    const next = ((parts ?? []) as Pick<TokenRow, "id" | "status" | "order_index" | "access_token">[]).find((p) => p.status === "pending");
    if (!next) break;

    const ctx = await loadSignContext(next.access_token);
    if (!ctx) return fail(NOT_FOUND);
    const who = ctx.me.name || ctx.me.email || "서명자";
    const stateError = docStateError(ctx) ?? participantStateError(ctx);
    if (stateError) return fail(`${who}: ${stateError}`);

    const res = await submitForParticipant(ctx, previewValues(ctx));
    if (!res.ok) return fail(`${who}: ${res.error}`);
    signed++;
    completed = !!res.data?.completed;
  }

  revalidatePath(`/workspaces/${doc.workspace_id}`, "layout");
  if (!signed) return fail("서명할 차례인 참여자가 없습니다.");
  return { ok: true, signed, completed };
}
