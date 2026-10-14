/**
 * Row triggers of the preview database.
 *
 * Built-ins mirror the data-shaping triggers of the migrations (guards that only police end-user
 * sessions are intentionally not emulated — there is no RLS emulation either):
 *   * custom_fields_limit          — before insert on custom_fields: max 30 per workspace ('custom_fields_limit')
 *   * workspace_members_prune_groups — after delete on workspace_members: drop the user from that workspace's groups
 * `on_auth_user_created` (handle_new_user) lives in the platform's auth layer.
 *
 * The platform can add more with `registerTrigger()` (stored on the HMR-safe global state).
 */
import type { PreviewDb, PreviewSession, Row } from "../types";
import { PgException } from "./errors";

export type TriggerOp = "insert" | "update" | "delete";

export interface TriggerEvent {
  /** db bound to the running statement (its writes are undone with it) */
  db: PreviewDb;
  table: string;
  op: TriggerOp;
  old: Row | null;
  new: Row | null;
  session?: PreviewSession;
}

export interface TriggerDef {
  name: string;
  table: string;
  timing: "before" | "after";
  events: TriggerOp[];
  /**
   * before insert/update: return a row to replace NEW, `null` to skip the row, nothing to keep it.
   * Throw a PgException to abort the statement.
   */
  fn: (ev: TriggerEvent) => Row | null | void;
}

export const BUILTIN_TRIGGERS: TriggerDef[] = [
  {
    name: "custom_fields_limit",
    table: "custom_fields",
    timing: "before",
    events: ["insert"],
    fn: ({ db, new: row }) => {
      const wid = row?.workspace_id;
      const count = db.rows("custom_fields").filter((r) => r.workspace_id === wid).length;
      if (count >= 30) throw new PgException("custom_fields_limit", "P0001");
    },
  },
  {
    name: "workspace_members_prune_groups",
    table: "workspace_members",
    timing: "after",
    events: ["delete"],
    fn: ({ db, old }) => {
      if (!old) return;
      const groupIds = new Set(db.rows("groups").filter((g) => g.workspace_id === old.workspace_id).map((g) => g.id));
      if (!groupIds.size) return;
      db.remove("group_members", (gm) => groupIds.has(gm.group_id) && gm.user_id === old.user_id);
    },
  },
];
