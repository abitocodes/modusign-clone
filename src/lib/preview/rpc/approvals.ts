/**
 * 내부결재 RPCs — mirrors of approval_submit (20261014016001_tools_approvals_files.sql, the version
 * with the owner / mime / size checks), approval_decide and approval_cancel
 * (20261014016000_tools_approvals.sql), plus can_view_approval.
 */
import { getObject } from "../storage-state";
import type { Row, RpcImpl } from "../types";
import {
  argBool,
  argInt,
  argText,
  argUuid,
  argUuidArray,
  authUid,
  btrim,
  charLength,
  defineRpc,
  find,
  isWorkspaceMember,
  nowIso,
  raise,
} from "./util";

const MAX_APPROVAL_BYTES = 10_485_760;

interface ApproverItem {
  user_id: string;
  name: string;
  email: string;
  status: string;
  comment: string | null;
  acted_at: string | null;
  [k: string]: unknown;
}

/** approval_submit(p_id, p_workspace_id, p_title, p_file_name, p_file_path, p_page_count, p_message, p_approver_ids, p_line_id default null) returns approvals */
const approval_submit = defineRpc(
  "approval_submit",
  ["p_id", "p_workspace_id", "p_title", "p_file_name", "p_file_path", "p_page_count", "p_message", "p_approver_ids", "p_line_id?"],
  (ctx, args) => {
    const db = ctx.db;
    const uid = authUid(ctx);
    const id = argUuid(args, "p_id");
    const wid = argUuid(args, "p_workspace_id");
    const title = btrim(argText(args, "p_title"));
    const rawMessage = btrim(argText(args, "p_message"));
    const message = rawMessage === "" ? null : rawMessage;
    const fileName = argText(args, "p_file_name");
    const filePath = argText(args, "p_file_path");
    const pageCount = argInt(args, "p_page_count");
    const approverIds = argUuidArray(args, "p_approver_ids");
    let lineId = argUuid(args, "p_line_id");

    if (!uid) raise("not_authenticated");
    if (!isWorkspaceMember(db, wid, uid)) raise("not_member");
    if (charLength(title) === 0 || charLength(title) > 100) raise("invalid_title");
    if (message !== null && charLength(message) > 500) raise("invalid_message");
    if (filePath === null || filePath !== `${wid}/approvals/${id}.pdf`) raise("invalid_file");
    const obj = getObject(db, "documents", filePath);
    if (!obj || obj.owner_id !== uid) raise("file_missing");
    if ((obj.contentType || "application/pdf") !== "application/pdf") raise("invalid_file");
    if (obj.bytes.byteLength > MAX_APPROVAL_BYTES) raise("file_too_large");
    if (approverIds === null || approverIds.length === 0) raise("no_approvers");
    if (approverIds.length > 10) raise("too_many_approvers");
    if (new Set(approverIds.filter((x) => x !== null)).size !== approverIds.length) raise("duplicate_approver");
    if (approverIds.includes(uid)) raise("self_approver");

    const me = find(db, "profiles", (p) => p.id === uid);
    const approvers: ApproverItem[] = approverIds.map((pid, i) => {
      const member = find(db, "workspace_members", (m) => m.user_id === pid && m.workspace_id === wid);
      const p = member ? find(db, "profiles", (x) => x.id === pid) : undefined;
      if (!p) raise("approver_not_member");
      return { user_id: p.id as string, name: p.name as string, email: p.email as string, status: i === 0 ? "pending" : "waiting", comment: null, acted_at: null };
    });

    if (lineId !== null && !find(db, "approval_lines", (l) => l.id === lineId && l.workspace_id === wid)) lineId = null;

    const now = nowIso();
    const name = btrim(fileName);
    const row = db.insert("approvals", {
      id,
      workspace_id: wid,
      drafter_id: uid,
      title,
      file_name: name === "" ? null : name,
      file_path: filePath,
      page_count: Math.max(pageCount ?? 1, 1),
      message,
      status: "in_progress",
      approvers,
      line_id: lineId,
      created_at: now,
      last_activity_at: now,
    });
    if (lineId !== null) db.update("approval_lines", (l) => l.id === lineId, { last_activity_at: nowIso() });
    db.insert("approval_events", { approval_id: id, type: "submitted", actor_id: uid, actor_name: me?.name ?? null, actor_email: me?.email ?? null, comment: message });
    return row;
  },
);

/** approval_decide(p_id uuid, p_approve boolean, p_comment text default null) returns jsonb */
const approval_decide = defineRpc("approval_decide", ["p_id", "p_approve", "p_comment?"], (ctx, args) => {
  const db = ctx.db;
  const uid = authUid(ctx);
  const id = argUuid(args, "p_id");
  const approve = argBool(args, "p_approve");
  const rawComment = btrim(argText(args, "p_comment"));
  const comment = rawComment === "" ? null : rawComment;
  if (!uid) raise("not_authenticated");

  const row = id ? find(db, "approvals", (a) => a.id === id) : undefined;
  if (!row || !isWorkspaceMember(db, row.workspace_id as string, uid)) raise("not_found");
  if (!["in_progress", "pending"].includes(row.status as string)) raise("not_in_progress");
  if (comment !== null && charLength(comment) > 500) raise("invalid_comment");
  if (!approve && comment === null) raise("comment_required");

  const list = (Array.isArray(row.approvers) ? row.approvers : []) as ApproverItem[];
  const idx = list.findIndex((e) => e && typeof e === "object" && e.status === "pending");
  if (idx < 0 || String(list[idx]?.user_id ?? "") !== uid) raise("not_your_turn");

  const now = nowIso();
  const approvers = list.map((e) => ({ ...e }));
  approvers[idx] = { ...approvers[idx], status: approve ? "approved" : "rejected", comment, acted_at: now };
  let next: ApproverItem | null = null;
  let status: string;
  if (approve) {
    if (idx + 1 < approvers.length) {
      approvers[idx + 1] = { ...approvers[idx + 1], status: "pending" };
      next = approvers[idx + 1];
      status = "in_progress";
    } else status = "approved";
  } else status = "rejected";

  db.update("approvals", (a) => a.id === id, {
    approvers,
    status,
    last_activity_at: now,
    completed_at: status === "approved" || status === "rejected" ? now : null,
  });
  const me = find(db, "profiles", (p) => p.id === uid);
  db.insert("approval_events", {
    approval_id: id,
    type: approve ? "approved" : "rejected",
    actor_id: uid,
    actor_name: me?.name ?? null,
    actor_email: me?.email ?? null,
    comment,
    created_at: now,
  });
  if (status === "approved") db.insert("approval_events", { approval_id: id, type: "completed", created_at: now });

  return { status, next, workspace_id: row.workspace_id, title: row.title, drafter_id: row.drafter_id };
});

/** approval_cancel(p_id uuid) returns void */
const approval_cancel = defineRpc("approval_cancel", ["p_id"], (ctx, args) => {
  const db = ctx.db;
  const uid = authUid(ctx);
  const id = argUuid(args, "p_id");
  if (!uid) raise("not_authenticated");
  const row = id ? find(db, "approvals", (a) => a.id === id) : undefined;
  if (!row || row.drafter_id !== uid) raise("not_found");
  if (!["in_progress", "pending"].includes(row.status as string)) raise("not_in_progress");
  const now = nowIso();
  const approvers = ((Array.isArray(row.approvers) ? row.approvers : []) as Row[]).map((e) =>
    e && typeof e === "object" && e.status === "pending" ? { ...e, status: "waiting" } : e,
  );
  db.update("approvals", (a) => a.id === id, { status: "cancelled", last_activity_at: now, completed_at: now, approvers });
  const me = find(db, "profiles", (p) => p.id === uid);
  db.insert("approval_events", { approval_id: id, type: "cancelled", actor_id: uid, actor_name: me?.name ?? null, actor_email: me?.email ?? null, created_at: now });
  return undefined;
});

/** can_view_approval(aid uuid) returns boolean */
const can_view_approval = defineRpc("can_view_approval", ["aid"], (ctx, args) => {
  const uid = authUid(ctx);
  const id = argUuid(args, "aid");
  const a = id ? find(ctx.db, "approvals", (x) => x.id === id) : undefined;
  if (!a || !isWorkspaceMember(ctx.db, a.workspace_id as string, uid)) return false;
  return a.drafter_id === uid || ((Array.isArray(a.approvers) ? a.approvers : []) as Row[]).some((e) => e && String(e.user_id) === uid);
});

export const APPROVAL_RPCS: Record<string, RpcImpl> = { approval_submit, approval_decide, approval_cancel, can_view_approval };
