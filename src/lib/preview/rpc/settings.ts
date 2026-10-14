/**
 * 통합 설정 RPCs — mirrors of 20261014017000_settings.sql: transfer_workspace_owner,
 * set_workspace_member_role, set_auto_share, workspace_audit_log, reassign_member_content.
 */
import { PgException } from "../engine/errors";
import type { Row, RpcImpl } from "../types";
import {
  SERVICE_ONLY,
  UUID_RE,
  argEnum,
  argInt,
  argText,
  argUuid,
  argUuidArray,
  authUid,
  btrim,
  clone,
  defineRpc,
  find,
  isWorkspaceAdmin,
  isWorkspaceMember,
  memberRole,
  ms,
  raise,
} from "./util";

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** transfer_workspace_owner(wid uuid, new_owner uuid) returns void */
const transfer_workspace_owner = defineRpc("transfer_workspace_owner", ["wid", "new_owner"], (ctx, args) => {
  const db = ctx.db;
  const wid = argUuid(args, "wid");
  const newOwner = argUuid(args, "new_owner");
  const uid = authUid(ctx);
  const ws = wid ? find(db, "workspaces", (w) => w.id === wid) : undefined;
  if (!ws) raise("not_found", "P0002");
  if (memberRole(db, wid, uid) !== "owner") raise("owner_only", "42501");
  if (ws.type === "personal") raise("personal_workspace", "22023");
  if (!isWorkspaceMember(db, wid, newOwner)) raise("not_member", "22023");
  const oldOwner = ws.owner_id as string;
  if (newOwner === oldOwner) return undefined;
  db.update("workspace_members", (m) => m.workspace_id === wid && m.user_id === newOwner, { role: "owner" });
  db.update("workspace_members", (m) => m.workspace_id === wid && m.user_id === oldOwner && m.role === "owner", { role: "admin" });
  db.update("workspaces", (w) => w.id === wid, { owner_id: newOwner });
  return undefined;
});

/** set_workspace_member_role(wid uuid, uid uuid, new_role member_role) returns void */
const set_workspace_member_role = defineRpc("set_workspace_member_role", ["wid", "uid", "new_role"], (ctx, args) => {
  const db = ctx.db;
  const wid = argUuid(args, "wid");
  const target = argUuid(args, "uid");
  const newRole = argEnum(db, "member_role", argText(args, "new_role"));
  const caller = memberRole(db, wid, authUid(ctx));
  const ws = wid ? find(db, "workspaces", (w) => w.id === wid) : undefined;
  if (!ws) raise("not_found", "P0002");
  if (caller === null || caller === "member") raise("forbidden", "42501");
  if (ws.type === "personal") raise("personal_workspace", "22023");
  const old = memberRole(db, wid, target);
  if (old === null) raise("not_member", "22023");
  if (old === newRole) return undefined;
  if ((newRole === "owner" || old === "owner") && caller !== "owner") raise("owner_only", "42501");
  if (old === "owner" && db.rows("workspace_members").filter((m) => m.workspace_id === wid && m.role === "owner").length <= 1) {
    raise("last_owner", "22023");
  }
  db.update("workspace_members", (m) => m.workspace_id === wid && m.user_id === target, { role: newRole });
  if (ws.owner_id === target && newRole !== "owner") {
    const next = db
      .rows("workspace_members")
      .filter((m) => m.workspace_id === wid && m.role === "owner")
      .sort((a, b) => ms(a.joined_at) - ms(b.joined_at))[0];
    db.update("workspaces", (w) => w.id === wid, { owner_id: (next?.user_id as string | undefined) ?? null });
  }
  return undefined;
});

/**
 * set_auto_share(wid uuid, scope text, user_ids uuid[]) returns jsonb
 * workspaces.settings.autoShare = { all: [userId], mine: { <requesterId>: [userId] } }
 */
const set_auto_share = defineRpc("set_auto_share", ["wid", "scope", "user_ids"], (ctx, args) => {
  const db = ctx.db;
  const wid = argUuid(args, "wid");
  const scope = argText(args, "scope");
  const ids = argUuidArray(args, "user_ids");
  const uid = authUid(ctx);
  if (!uid || !isWorkspaceMember(db, wid, uid)) raise("forbidden", "42501");
  let target: string | null = null;
  if (scope === "all") {
    if (!isWorkspaceAdmin(db, wid, uid)) raise("forbidden", "42501");
  } else {
    // NULL::uuid: the comparisons are NULL, the membership lookup finds nothing
    if (scope === null) raise("not_member", "22023");
    if (!UUID_RE.test(scope.trim())) throw new PgException(`invalid input syntax for type uuid: "${scope}"`, "22P02");
    target = scope.trim().toLowerCase();
    if (target !== uid && !isWorkspaceAdmin(db, wid, uid)) raise("forbidden", "42501");
    if (!isWorkspaceMember(db, wid, target)) raise("not_member", "22023");
  }
  if ((ids?.length ?? 0) > 20) raise("too_many", "22023");

  // workspace members only, de-duplicated (first occurrence), in the given order
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const u of ids ?? []) {
    if (u === null || seen.has(u)) continue;
    seen.add(u);
    if (isWorkspaceMember(db, wid, u)) kept.push(u);
  }

  const ws = find(db, "workspaces", (w) => w.id === wid);
  const settings: Record<string, unknown> = isObject(ws?.settings) ? clone(ws.settings as Record<string, unknown>) : {};
  let auto: Record<string, unknown> = isObject(settings.autoShare) ? (settings.autoShare as Record<string, unknown>) : {};
  if (!isObject(auto.mine)) auto = { ...auto, mine: {} };
  if (scope === "all") auto = { ...auto, all: kept };
  else auto = { ...auto, mine: { ...(auto.mine as Record<string, unknown>), [target as string]: kept } };
  if (ws) db.update("workspaces", (w) => w.id === wid, { settings: { ...settings, autoShare: auto } });
  return auto;
});

/** workspace_audit_log(wid uuid, q text, etype text, lim integer default 20, off integer default 0) returns table */
const workspace_audit_log = defineRpc("workspace_audit_log", ["wid", "q?", "etype?", "lim?", "off?"], (ctx, args) => {
  const db = ctx.db;
  const wid = argUuid(args, "wid");
  const term = btrim(argText(args, "q"));
  const etype = argText(args, "etype");
  const lim = Math.max(1, Math.min(argInt(args, "lim") ?? 20, 100));
  const off = Math.max(argInt(args, "off") ?? 0, 0);
  if (!isWorkspaceAdmin(db, wid, authUid(ctx))) return [];
  const needle = term.toLowerCase();
  const like = (v: unknown) => typeof v === "string" && v.toLowerCase().includes(needle);
  const docs = new Map(db.rows("documents").filter((d) => d.workspace_id === wid).map((d) => [d.id as string, d]));
  const rows = db
    .rows("document_events")
    .filter((e) => docs.has(e.document_id as string))
    .filter((e) => etype === null || etype === "" || e.type === etype)
    .filter((e) => {
      if (!term) return true;
      const d = docs.get(e.document_id as string) as Row;
      return like(e.actor_name) || like(e.actor_email) || like(d.title) || like(e.ip);
    })
    .sort((a, b) => ms(b.created_at) - ms(a.created_at) || ((a.id as string) < (b.id as string) ? -1 : 1));
  const total = rows.length;
  return rows.slice(off, off + lim).map((e) => ({
    id: e.id,
    document_id: e.document_id,
    document_title: (docs.get(e.document_id as string) as Row).title,
    type: e.type,
    actor_name: e.actor_name,
    actor_email: e.actor_email,
    ip: e.ip,
    meta: clone(e.meta),
    created_at: e.created_at,
    total_count: total,
  }));
});

/** reassign_member_content(wid uuid, from_uid uuid, to_uid uuid) returns void — service role */
const reassign_member_content = defineRpc(
  "reassign_member_content",
  ["wid", "from_uid", "to_uid"],
  (ctx, args) => {
    const db = ctx.db;
    const wid = argUuid(args, "wid");
    const from = argUuid(args, "from_uid");
    const to = argUuid(args, "to_uid");
    for (const [name, t] of db.schema.tables) {
      if (name === "workspaces" || !t.columns.has("workspace_id")) continue;
      for (const col of ["owner_id", "drafter_id"]) {
        if (!t.columns.has(col)) continue;
        db.update(name, (r) => r.workspace_id === wid && r[col] === from && from !== null, { [col]: to });
      }
    }
    return undefined;
  },
  SERVICE_ONLY,
);

export const SETTINGS_RPCS: Record<string, RpcImpl> = {
  transfer_workspace_owner,
  set_workspace_member_role,
  set_auto_share,
  workspace_audit_log,
  reassign_member_content,
};
