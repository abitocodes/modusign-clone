/**
 * Document / signer RPCs — mirrors of the SQL functions in
 *   20261014014001_field_editor.sql      replace_document_fields
 *   20261014030000_security_hardening.sql sign_identity_register_failure, link_sign_reserve,
 *                                         sign_submit, sign_reject, doc_cancel_request,
 *                                         doc_start_modify, my_pending_sign_tokens
 * plus the boolean helpers of the init migration (not called by the app today).
 */
import { PgException } from "../engine/errors";
import type { Row, RpcImpl } from "../types";
import {
  SERVICE_ONLY,
  UUID_RE,
  argBool,
  argJson,
  argText,
  argUuid,
  argUuidArray,
  authUid,
  canEditDocument,
  canViewDocument,
  currentEmail,
  defineRpc,
  find,
  isWorkspaceAdmin,
  isWorkspaceMember,
  ms,
  nowIso,
  raise,
} from "./util";

const MINUTE = 60_000;

/* ------------------------------------------------------------ casts of jsonb text */

function jsonText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return typeof v === "string" ? v : JSON.stringify(v);
}
function castUuid(s: string | null): string | null {
  if (s === null) return null;
  if (!UUID_RE.test(s.trim())) throw new PgException(`invalid input syntax for type uuid: "${s}"`, "22P02");
  return s.trim().toLowerCase();
}
function castInt(s: string | null): number | null {
  if (s === null) return null;
  if (!/^\s*[-+]?\d+\s*$/.test(s)) throw new PgException(`invalid input syntax for type integer: "${s}"`, "22P02");
  return Number(s);
}
function castDouble(s: string | null): number | null {
  if (s === null) return null;
  const n = Number(s);
  if (s.trim() === "" || Number.isNaN(n)) throw new PgException(`invalid input syntax for type double precision: "${s}"`, "22P02");
  return n;
}
function castBool(s: string | null): boolean | null {
  if (s === null) return null;
  if (/^(t|true|y|yes|on|1)$/i.test(s.trim())) return true;
  if (/^(f|false|n|no|off|0)$/i.test(s.trim())) return false;
  throw new PgException(`invalid input syntax for type boolean: "${s}"`, "22P02");
}
/** greatest() ignores NULLs */
const greatest = (v: number | null, min: number) => (v === null ? min : Math.max(v, min));
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
/** `elem ->> key` (NULL for non-objects) */
const field = (elem: unknown, key: string) => (isObject(elem) ? jsonText(elem[key]) : null);

/* ------------------------------------------------------------------ RPCs */

/** replace_document_fields(p_document_id uuid, p_fields jsonb) returns integer — SECURITY INVOKER */
const replace_document_fields = defineRpc("replace_document_fields", ["p_document_id", "p_fields"], (ctx, args) => {
  const db = ctx.db;
  const did = argUuid(args, "p_document_id");
  const fields = argJson(args, "p_fields");
  if (fields === null || !Array.isArray(fields)) raise("fields must be a json array", "22023");
  const doc = did ? find(db, "documents", (d) => d.id === did) : undefined;
  const uid = authUid(ctx);
  if (!doc || !isWorkspaceMember(db, doc.workspace_id as string, uid)) raise("document not found", "42501");
  if (!["draft", "on_modifying"].includes(doc.status as string)) raise("document is not editable", "55000");

  const participantIds = new Set(db.rows("participants").filter((p) => p.document_id === did).map((p) => p.id as string));
  for (const f of fields) {
    const pid = castUuid(field(f, "participant_id") === "" ? null : field(f, "participant_id"));
    if (!pid || !participantIds.has(pid)) raise("unknown participant", "22023");
  }

  db.remove("fields", (r) => r.document_id === did);
  let count = 0;
  for (const f of fields) {
    const options = isObject(f) && isObject(f.options) ? f.options : {};
    const id = field(f, "id");
    db.insert("fields", {
      id: castUuid(id === "" ? null : id) ?? db.uuid(),
      document_id: did,
      participant_id: castUuid(field(f, "participant_id")),
      type: field(f, "type"),
      page: greatest(castInt(field(f, "page")) ?? 1, 1),
      x: greatest(castDouble(field(f, "x")), 0),
      y: greatest(castDouble(field(f, "y")), 0),
      width: greatest(castDouble(field(f, "width")), 1),
      height: greatest(castDouble(field(f, "height")), 1),
      required: castBool(field(f, "required")) ?? true,
      options,
    });
    count++;
  }
  db.update("documents", (d) => d.id === did, { last_activity_at: nowIso() });
  return count;
});

/** Shared start of sign_submit / sign_reject: 'ok' or the verdict. */
function claimTurn(ctx: Parameters<RpcImpl>[0], participantId: string | null): { verdict: string; doc?: Row; me?: Row } {
  const db = ctx.db;
  const me = participantId ? find(db, "participants", (p) => p.id === participantId) : undefined;
  if (!me) return { verdict: "not_found" };
  const doc = find(db, "documents", (d) => d.id === me.document_id);
  if ((doc?.status ?? null) !== "in_progress") return { verdict: "doc_state" };
  if (me.status !== "pending") return { verdict: "already" };
  if (me.expires_at !== null && ms(me.expires_at) < Date.now()) return { verdict: "expired" };
  return { verdict: "ok", doc, me };
}

/** sign_submit(p_participant_id uuid, p_values jsonb, p_view boolean) returns text — service role */
const sign_submit = defineRpc(
  "sign_submit",
  ["p_participant_id", "p_values", "p_view"],
  (ctx, args) => {
    const db = ctx.db;
    const pid = argUuid(args, "p_participant_id");
    const values = argJson(args, "p_values");
    const view = argBool(args, "p_view");
    const { verdict, doc, me } = claimTurn(ctx, pid);
    if (verdict !== "ok" || !doc || !me) return verdict;

    const now = nowIso();
    const entries = isObject(values) ? Object.entries(values) : [];
    // jsonb_each_text + v.key::uuid (a malformed key aborts the statement)
    const byId = new Map<string, string | null>();
    for (const [k, v] of entries) byId.set(castUuid(k) as string, jsonText(v));
    for (const [id, v] of byId) {
      db.update("fields", (f) => f.id === id && f.participant_id === me.id && f.document_id === doc.id, { value: v === "" ? null : v, filled_at: now });
    }
    if (view) {
      db.update("participants", (p) => p.id === me.id, { status: "viewed", viewed_at: me.viewed_at ?? now, draft_values: {} });
    } else {
      db.update("participants", (p) => p.id === me.id, { status: "signed", signed_at: now, viewed_at: me.viewed_at ?? now, draft_values: {} });
    }
    db.update("documents", (d) => d.id === doc.id, { last_activity_at: now });
    return "ok";
  },
  SERVICE_ONLY,
);

/** sign_reject(p_participant_id uuid, p_reason text) returns text — service role */
const sign_reject = defineRpc(
  "sign_reject",
  ["p_participant_id", "p_reason"],
  (ctx, args) => {
    const db = ctx.db;
    const pid = argUuid(args, "p_participant_id");
    const reason = argText(args, "p_reason");
    const { verdict, doc, me } = claimTurn(ctx, pid);
    if (verdict !== "ok" || !doc || !me) return verdict;
    const now = nowIso();
    db.update("participants", (p) => p.id === me.id, {
      status: "rejected",
      reject_reason: reason === null ? null : Array.from(reason).slice(0, 500).join(""),
      draft_values: {},
    });
    db.update("documents", (d) => d.id === doc.id, { status: "rejected", last_activity_at: now });
    return "ok";
  },
  SERVICE_ONLY,
);

/** sign_identity_register_failure(p_participant uuid) returns timestamptz — service role */
const sign_identity_register_failure = defineRpc(
  "sign_identity_register_failure",
  ["p_participant"],
  (ctx, args) => {
    const db = ctx.db;
    const pid = argUuid(args, "p_participant");
    const now = nowIso();
    const existing = find(db, "participant_identity_attempts", (a) => a.participant_id === pid);
    let failures: number;
    let total: number;
    if (existing) {
      failures = (existing.failures as number) + 1;
      total = (existing.total_failures as number) + 1;
      db.update("participant_identity_attempts", (a) => a.participant_id === pid, { failures, total_failures: total, last_failed_at: now, updated_at: now });
    } else {
      failures = 1;
      total = 1;
      db.insert("participant_identity_attempts", { participant_id: pid, failures, total_failures: total, last_failed_at: now, updated_at: now });
    }
    let until: string | null = null;
    if (total >= 20) until = "infinity";
    else if (failures >= 5) until = new Date(Date.now() + Math.min(MINUTE * 2 ** (failures - 5), 24 * 60 * MINUTE)).toISOString();
    db.update("participant_identity_attempts", (a) => a.participant_id === pid, { locked_until: until });
    return until;
  },
  SERVICE_ONLY,
);

/** link_sign_reserve(p_link_id uuid, p_email_norm text, p_ip text) returns text — service role */
const link_sign_reserve = defineRpc(
  "link_sign_reserve",
  ["p_link_id", "p_email_norm", "p_ip"],
  (ctx, args) => {
    const db = ctx.db;
    const link = argUuid(args, "p_link_id");
    const email = argText(args, "p_email_norm");
    const ip = argText(args, "p_ip");
    const now = Date.now();
    db.remove("link_sign_attempts", (a) => a.link_id === link && ms(a.created_at) < now - 2 * 24 * 60 * MINUTE);
    const attempts = db.rows("link_sign_attempts").filter((a) => a.link_id === link);
    const since = (minutes: number) => attempts.filter((a) => ms(a.created_at) > now - minutes * MINUTE);
    if (since(1).length >= 10) return "rate_link";
    if (since(24 * 60).length >= 200) return "rate_daily";
    if (since(10).filter((a) => a.email_norm === email).length >= 3) return "rate_email";
    if (ip !== null && since(10).filter((a) => a.ip === ip).length >= 10) return "rate_ip";
    db.insert("link_sign_attempts", { link_id: link, email_norm: email, ip });
    return "ok";
  },
  SERVICE_ONLY,
);

/** doc_cancel_request(p_document_id uuid) returns text */
const doc_cancel_request = defineRpc("doc_cancel_request", ["p_document_id"], (ctx, args) => {
  const db = ctx.db;
  const uid = authUid(ctx);
  if (!uid) return "forbidden";
  const did = argUuid(args, "p_document_id");
  const doc = did ? find(db, "documents", (d) => d.id === did) : undefined;
  if (!doc || !isWorkspaceMember(db, doc.workspace_id as string, uid)) return "not_found";
  if (doc.owner_id !== uid && !isWorkspaceAdmin(db, doc.workspace_id as string, uid)) return "forbidden";
  if (!["in_progress", "scheduled", "on_modifying"].includes(doc.status as string)) return "state";
  db.update("documents", (d) => d.id === did, { status: "request_cancelled", last_activity_at: nowIso() });
  return "ok";
});

/** doc_start_modify(p_document_id uuid) returns text */
const doc_start_modify = defineRpc("doc_start_modify", ["p_document_id"], (ctx, args) => {
  const db = ctx.db;
  const uid = authUid(ctx);
  if (!uid) return "forbidden";
  const did = argUuid(args, "p_document_id");
  const doc = did ? find(db, "documents", (d) => d.id === did) : undefined;
  if (!doc || !isWorkspaceMember(db, doc.workspace_id as string, uid)) return "not_found";
  if (doc.owner_id !== uid && !isWorkspaceAdmin(db, doc.workspace_id as string, uid)) return "forbidden";
  if (!["in_progress", "scheduled"].includes(doc.status as string)) return "state";
  const acted = db
    .rows("participants")
    .some((p) => p.document_id === did && (["signed", "viewed", "rejected"].includes(p.status as string) || p.signed_at !== null));
  if (acted) return "acted";
  db.update("documents", (d) => d.id === did, { status: "on_modifying", last_activity_at: nowIso() });
  return "ok";
});

/** my_pending_sign_tokens(p_document_ids uuid[]) returns table (document_id uuid, access_token uuid) */
const my_pending_sign_tokens = defineRpc("my_pending_sign_tokens", ["p_document_ids"], (ctx, args) => {
  const db = ctx.db;
  const ids = new Set((argUuidArray(args, "p_document_ids") ?? []).filter(Boolean));
  const email = currentEmail(ctx);
  const uid = authUid(ctx);
  if (!email) return [];
  const now = Date.now();
  const best = new Map<string, Row>();
  for (const p of db.rows("participants")) {
    const did = p.document_id as string;
    if (!ids.has(did)) continue;
    if (typeof p.email !== "string" || p.email.toLowerCase() !== email) continue;
    if (p.status !== "pending") continue;
    if (p.expires_at !== null && !(ms(p.expires_at) > now)) continue;
    const doc = find(db, "documents", (d) => d.id === did);
    if (!doc || doc.status !== "in_progress" || !canViewDocument(db, did, uid, email)) continue;
    const prev = best.get(did);
    if (!prev || (p.order_index as number) < (prev.order_index as number)) best.set(did, p);
  }
  return [...best.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([document_id, p]) => ({ document_id, access_token: p.access_token as string }));
});

/* ------------------------------------------------- helpers (init migration) */

const is_workspace_member = defineRpc("is_workspace_member", ["wid"], (ctx, args) => isWorkspaceMember(ctx.db, argUuid(args, "wid"), authUid(ctx)));
const is_workspace_admin = defineRpc("is_workspace_admin", ["wid"], (ctx, args) => isWorkspaceAdmin(ctx.db, argUuid(args, "wid"), authUid(ctx)));
const current_email = defineRpc("current_email", [], (ctx) => currentEmail(ctx));
const can_view_document = defineRpc("can_view_document", ["did"], (ctx, args) => canViewDocument(ctx.db, argUuid(args, "did"), authUid(ctx), currentEmail(ctx)));
const can_edit_document = defineRpc("can_edit_document", ["did"], (ctx, args) => canEditDocument(ctx.db, argUuid(args, "did"), authUid(ctx)));
const shares_workspace_with = defineRpc("shares_workspace_with", ["uid"], (ctx, args) => {
  const other = argUuid(args, "uid");
  const me = authUid(ctx);
  if (other !== null && other === me) return true;
  const mine = new Set(ctx.db.rows("workspace_members").filter((m) => m.user_id === me).map((m) => m.workspace_id));
  return ctx.db.rows("workspace_members").some((m) => m.user_id === other && mine.has(m.workspace_id));
});

export const DOCUMENT_RPCS: Record<string, RpcImpl> = {
  replace_document_fields,
  sign_submit,
  sign_reject,
  sign_identity_register_failure,
  link_sign_reserve,
  doc_cancel_request,
  doc_start_modify,
  my_pending_sign_tokens,
  is_workspace_member,
  is_workspace_admin,
  current_email,
  can_view_document,
  can_edit_document,
  shares_workspace_with,
};
