/**
 * Helpers of the preview RPC implementations (plpgsql → TypeScript).
 *
 * Imports only specific engine files (never ../engine or ../engine/execute: execute.ts imports
 * this registry). No "@/…" / "server-only" imports.
 */
import { PgException } from "../engine/errors";
import type { PgError, PreviewDb, Row, RpcContext, RpcImpl } from "../types";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** plpgsql `raise exception '<message>' [using errcode = '<code>']` */
export function raise(message: string, code = "P0001"): never {
  throw new PgException(message, code);
}

type Args = Record<string, unknown>;

const text = (v: unknown) => (typeof v === "string" ? v : typeof v === "object" ? JSON.stringify(v) : String(v));

/* ---------------------------------------------------------------- arguments */

/** uuid parameter (PostgREST casts the JSON value; garbage → 22P02) */
export function argUuid(args: Args, name: string): string | null {
  const v = args[name];
  if (v === null || v === undefined) return null;
  const s = text(v).trim();
  if (!UUID_RE.test(s)) throw new PgException(`invalid input syntax for type uuid: "${text(v)}"`, "22P02");
  return s.toLowerCase();
}

export function argUuidArray(args: Args, name: string): string[] | null {
  const v = args[name];
  if (v === null || v === undefined) return null;
  let arr: unknown[];
  if (Array.isArray(v)) arr = v;
  else if (typeof v === "string" && /^\{[\s\S]*\}$/.test(v.trim())) {
    const body = v.trim().slice(1, -1).trim();
    arr = body ? body.split(",").map((x) => x.trim().replace(/^"|"$/g, "")) : [];
  } else throw new PgException(`malformed array literal: "${text(v)}"`, "22P02");
  return arr.map((x) => {
    if (x === null || x === undefined || (typeof x === "string" && /^null$/i.test(x))) return null as unknown as string;
    const s = text(x).trim();
    if (!UUID_RE.test(s)) throw new PgException(`invalid input syntax for type uuid: "${text(x)}"`, "22P02");
    return s.toLowerCase();
  });
}

export function argText(args: Args, name: string): string | null {
  const v = args[name];
  if (v === null || v === undefined) return null;
  return text(v);
}

export function argInt(args: Args, name: string): number | null {
  const v = args[name];
  if (v === null || v === undefined) return null;
  if (typeof v === "number" && Number.isInteger(v)) return v;
  if (typeof v === "string" && /^\s*[-+]?\d+\s*$/.test(v)) return Number(v);
  throw new PgException(`invalid input syntax for type integer: "${text(v)}"`, "22P02");
}

export function argBool(args: Args, name: string): boolean | null {
  const v = args[name];
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    if (/^(t|true|y|yes|on|1)$/i.test(v.trim())) return true;
    if (/^(f|false|n|no|off|0)$/i.test(v.trim())) return false;
  }
  throw new PgException(`invalid input syntax for type boolean: "${text(v)}"`, "22P02");
}

/** jsonb parameter: the JSON value as given (a JSON string stays a string, like PostgREST) */
export function argJson(args: Args, name: string): unknown {
  const v = args[name];
  return v === undefined ? null : v;
}

export function argEnum(db: PreviewDb, type: string, v: string | null): string | null {
  if (v === null) return null;
  const values = db.schema.enums.get(type);
  if (values && !values.includes(v)) throw new PgException(`invalid input value for enum ${type}: "${v}"`, "22P02");
  return v;
}

/* ---------------------------------------------------------------- signatures */

export interface ParamDef {
  name: string;
  /** has a default (`p default null`) → may be omitted */
  optional?: boolean;
}

/** EXECUTE grants of a function (the migrations revoke `anon` almost everywhere). */
export type Grant = "anon" | "authenticated" | "service_role";
export const USER_AND_SERVICE: Grant[] = ["authenticated", "service_role"];
export const SERVICE_ONLY: Grant[] = ["service_role"];

/**
 * Wraps an implementation with PostgREST's function resolution: the JSON keys must name the
 * function's parameters (unknown keys / missing required ones → PGRST202, as the real API answers),
 * and the caller's role needs the EXECUTE grant (42501 otherwise). `params`: "name" or "name?"
 * (has a default).
 */
export function defineRpc(
  fn: string,
  params: (string | ParamDef)[],
  impl: (ctx: RpcContext, args: Args) => unknown | Promise<unknown>,
  grants: Grant[] = USER_AND_SERVICE,
): RpcImpl {
  const defs = params.map((p) => (typeof p === "string" ? { name: p.replace(/\?$/, ""), optional: p.endsWith("?") } : p));
  const names = new Set(defs.map((d) => d.name));
  return async (ctx, args) => {
    if (!grants.includes(ctx.session.role)) {
      return { data: null, error: { message: `permission denied for function ${fn}`, code: "42501", details: null, hint: null } };
    }
    const keys = Object.keys(args ?? {});
    const unknown = keys.filter((k) => !names.has(k));
    const missing = defs.filter((d) => !d.optional && !keys.includes(d.name));
    if (unknown.length || missing.length) {
      const sig = [...keys].sort().join(", ");
      console.warn(`[preview] rpc ${fn}: no function with parameters (${sig}) — expected (${defs.map((d) => d.name + (d.optional ? "?" : "")).join(", ")})`);
      const error: PgError = {
        message: `Could not find the function public.${fn}(${sig}) in the schema cache`,
        code: "PGRST202",
        details: `Searched for the function public.${fn} with parameters ${sig || "(none)"} or with a single unnamed json/jsonb parameter, but no matches were found in the schema cache.`,
        hint: `Perhaps you meant to call the function public.${fn}(${defs.map((d) => d.name).join(", ")})`,
      };
      return { data: null, error };
    }
    const data = await impl(ctx, args ?? {});
    return { data, error: null };
  };
}

/* ---------------------------------------------------------------- session */

/** auth.uid() */
export const authUid = (ctx: RpcContext): string | null => (ctx.session.role === "authenticated" ? ctx.session.userId : null);

/** public.current_email(): lower(coalesce(auth.jwt() ->> 'email', '')) */
export const currentEmail = (ctx: RpcContext): string => (ctx.session.role === "authenticated" ? (ctx.session.email ?? "").toLowerCase() : "");

/* ---------------------------------------------------------------- lookups */

export function find(db: PreviewDb, table: string, pred: (r: Row) => boolean): Row | undefined {
  return db.rows(table).find(pred);
}

export function memberRole(db: PreviewDb, wid: string | null, uid: string | null): string | null {
  if (!wid || !uid) return null;
  return (find(db, "workspace_members", (m) => m.workspace_id === wid && m.user_id === uid)?.role as string | undefined) ?? null;
}

/** public.is_workspace_member(wid) */
export const isWorkspaceMember = (db: PreviewDb, wid: string | null, uid: string | null) => memberRole(db, wid, uid) !== null;

/** public.is_workspace_admin(wid) */
export function isWorkspaceAdmin(db: PreviewDb, wid: string | null, uid: string | null) {
  const r = memberRole(db, wid, uid);
  return r === "owner" || r === "admin";
}

/** public.can_view_document(did) */
export function canViewDocument(db: PreviewDb, did: string | null, uid: string | null, email: string): boolean {
  const d = did ? find(db, "documents", (x) => x.id === did) : undefined;
  if (!d) return false;
  if (isWorkspaceMember(db, d.workspace_id as string, uid)) return true;
  return !!email && db.rows("participants").some((p) => p.document_id === did && typeof p.email === "string" && p.email.toLowerCase() === email);
}

/** public.can_edit_document(did) */
export function canEditDocument(db: PreviewDb, did: string | null, uid: string | null): boolean {
  const d = did ? find(db, "documents", (x) => x.id === did) : undefined;
  if (!d || !["draft", "on_modifying"].includes(d.status as string)) return false;
  const wid = d.workspace_id as string;
  return isWorkspaceMember(db, wid, uid) && (d.owner_id === uid || isWorkspaceAdmin(db, wid, uid));
}

export const nowIso = () => new Date().toISOString();
export const ms = (iso: unknown) => (typeof iso === "string" ? (iso === "infinity" ? Infinity : iso === "-infinity" ? -Infinity : Date.parse(iso)) : NaN);

/** btrim(coalesce(s, '')) — Postgres btrim() strips spaces only */
export const btrim = (s: string | null | undefined) => (s ?? "").replace(/^ +| +$/g, "");
/** char_length (code points) */
export const charLength = (s: string) => Array.from(s).length;

/** SQL `a is distinct from b` for scalars */
export const isDistinct = (a: unknown, b: unknown) => (a ?? null) !== (b ?? null);

export function updateRows(db: PreviewDb, table: string, pred: (r: Row) => boolean, patch: Row): Row[] {
  return db.update(table, pred, patch);
}

export const clone = <T>(v: T): T => (v === undefined || v === null ? v : (JSON.parse(JSON.stringify(v)) as T));
