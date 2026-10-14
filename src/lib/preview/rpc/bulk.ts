/**
 * 대량전송 RPCs — mirrors of bulk_send_settle / bulk_send_claim / bulk_send_report
 * (20261014019000_templates_bulk_links.sql). SECURITY INVOKER: for user sessions the row is only
 * visible to workspace members (select policy) and lockable (FOR UPDATE → update policy) by its
 * owner or a workspace owner/admin — a row outside that raises not_found like the real functions.
 */
import { PgException } from "../engine/errors";
import type { PreviewDb, Row, RpcContext, RpcImpl } from "../types";
import { argInt, argJson, argUuid, authUid, clone, defineRpc, find, isWorkspaceAdmin, isWorkspaceMember, ms, nowIso, raise } from "./util";

type Item = Record<string, unknown>;
const isObject = (v: unknown): v is Item => !!v && typeof v === "object" && !Array.isArray(v);
const statusOf = (e: unknown) => (isObject(e) && typeof e.status === "string" ? e.status : isObject(e) && e.status != null ? JSON.stringify(e.status) : null);

/** the row as the caller's RLS lets them see / lock it */
function loadBatch(ctx: RpcContext, id: string | null, forUpdate: boolean): Row {
  const db = ctx.db;
  const row = id ? find(db, "bulk_sends", (b) => b.id === id) : undefined;
  if (!row) raise("not_found", "P0002");
  if (ctx.session.role !== "service_role") {
    const uid = authUid(ctx);
    const wid = row.workspace_id as string;
    const visible = isWorkspaceMember(db, wid, uid);
    const lockable = visible && (row.owner_id === uid || isWorkspaceAdmin(db, wid, uid));
    if (!visible || (forUpdate && !lockable)) raise("not_found", "P0002");
  }
  return row;
}

function settle(db: PreviewDb, row: Row) {
  const items = (Array.isArray(row.recipients) ? row.recipients : []) as unknown[];
  const total = items.length;
  const count = (pred: (s: string | null) => boolean) => items.filter((e) => pred(statusOf(e))).length;
  const sent = count((s) => s === "sent");
  const failed = count((s) => s === "failed");
  const pending = count((s) => (s ?? "pending") === "pending");
  const processing = count((s) => s === "processing");
  let status = row.status as string;
  if (status === "sending" && pending === 0 && processing === 0) {
    status = sent > 0 ? "sent" : "failed";
    db.update("bulk_sends", (b) => b.id === row.id, { status, sent_at: nowIso() });
  }
  return { status, total, sent, failed, pending, processing };
}

/** bulk_send_settle(p_bulk_id uuid) returns jsonb */
const bulk_send_settle = defineRpc("bulk_send_settle", ["p_bulk_id"], (ctx, args) => {
  const row = loadBatch(ctx, argUuid(args, "p_bulk_id"), false);
  return settle(ctx.db, row);
});

/** bulk_send_claim(p_bulk_id uuid, p_limit integer default 5) returns jsonb */
const bulk_send_claim = defineRpc("bulk_send_claim", ["p_bulk_id", "p_limit?"], (ctx, args) => {
  const db = ctx.db;
  const row = loadBatch(ctx, argUuid(args, "p_bulk_id"), true);
  const limit = Math.max(1, Math.min(argInt(args, "p_limit") ?? 5, 20));
  const claimed: Item[] = [];
  if (row.status !== "sending") return claimed;

  const now = Date.now();
  const nowStr = new Date(now).toISOString();
  const items = clone((Array.isArray(row.recipients) ? row.recipients : []) as unknown[]);
  let changed = false;
  for (let i = 0; i < items.length; i++) {
    const elem = items[i];
    const status = statusOf(elem) ?? "pending";
    const claimedAt = isObject(elem) && elem.claimed_at != null ? ms(String(elem.claimed_at)) : -Infinity;
    if (isObject(elem) && elem.claimed_at != null && Number.isNaN(claimedAt)) {
      throw new PgException(`invalid input syntax for type timestamp with time zone: "${String(elem.claimed_at)}"`, "22007");
    }
    if (status === "processing" && claimedAt < now - 10 * 60_000) {
      const { claimed_at: _drop, ...rest } = elem as Item;
      void _drop;
      items[i] = { ...rest, status: "failed", error: "전송 처리가 중단되었습니다. 문서함에서 전송 여부를 확인해 주세요.", processed_at: nowStr };
      changed = true;
    } else if (status === "pending" && claimed.length < limit) {
      items[i] = { ...(isObject(elem) ? elem : {}), status: "processing", claimed_at: nowStr };
      const e = isObject(elem) ? elem : {};
      claimed.push({ index: i, name: e.name == null ? null : String(e.name), email: e.email == null ? null : String(e.email) });
      changed = true;
    }
  }
  if (changed) {
    const [updated] = db.update("bulk_sends", (b) => b.id === row.id, { recipients: items });
    settle(db, updated ?? row);
  }
  return claimed;
});

/** bulk_send_report(p_bulk_id uuid, p_results jsonb) returns jsonb */
const bulk_send_report = defineRpc("bulk_send_report", ["p_bulk_id", "p_results"], (ctx, args) => {
  const db = ctx.db;
  const row = loadBatch(ctx, argUuid(args, "p_bulk_id"), true);
  const items = clone((Array.isArray(row.recipients) ? row.recipients : []) as unknown[]);
  const results = argJson(args, "p_results");
  const list = results === null ? [] : Array.isArray(results) ? results : null;
  if (list === null) throw new PgException("cannot extract elements from an object", "22023");
  const now = nowIso();
  for (const res of list) {
    if (!isObject(res) || typeof res.index !== "number") continue;
    if (!Number.isInteger(res.index)) throw new PgException(`invalid input syntax for type integer: "${res.index}"`, "22P02");
    const i = res.index;
    if (i < 0 || i >= items.length) continue;
    if ((statusOf(items[i]) ?? "pending") !== "processing") continue;
    const status = res.status === "sent" ? "sent" : "failed";
    const { claimed_at: _drop, ...rest } = (isObject(items[i]) ? items[i] : {}) as Item;
    void _drop;
    const err = typeof res.error === "string" ? res.error : res.error == null ? "" : JSON.stringify(res.error);
    items[i] = {
      ...rest,
      status,
      document_id: typeof res.document_id === "string" ? res.document_id : null,
      error: status === "failed" ? Array.from(err || "전송하지 못했습니다.").slice(0, 200).join("") : null,
      processed_at: now,
    };
  }
  const [updated] = db.update("bulk_sends", (b) => b.id === row.id, { recipients: items });
  return settle(db, updated ?? row);
});

export const BULK_RPCS: Record<string, RpcImpl> = { bulk_send_settle, bulk_send_claim, bulk_send_report };
