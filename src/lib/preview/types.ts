/**
 * Contracts of the preview (mock backend) layer. See src/lib/preview/DESIGN.md.
 * Everything here is plain data so that browser calls can be serialised to the
 * /api/preview route and executed by the same server-side engine.
 */

export type Row = Record<string, unknown>;

/** PostgREST-like error (shape of supabase-js PostgrestError). */
export interface PgError {
  message: string;
  code: string;
  details: string | null;
  hint: string | null;
}

/** What `await supabase.from(...)...` / `.rpc(...)` resolve to. */
export interface PgResult<T = unknown> {
  data: T | null;
  error: PgError | null;
  count: number | null;
  status: number;
  statusText: string;
  /** supabase-js 2.10x+ also reports `success` (= error === null) */
  success?: boolean;
}

/** Who is calling. `service_role` = admin client (no RLS emulation anyway). */
export interface PreviewSession {
  role: "anon" | "authenticated" | "service_role";
  userId: string | null;
  email: string | null;
}

/** One recorded builder call, e.g. { m: "eq", a: ["id", "…"] }. Args must be JSON-serialisable. */
export interface ChainCall {
  m: string;
  a: unknown[];
}

/** A serialised data-API request (from the browser recorder or the server recorder). */
export type DataOp =
  | { kind: "from"; table: string; chain: ChainCall[] }
  | {
      kind: "rpc";
      fn: string;
      args: Record<string, unknown>;
      options?: { head?: boolean; get?: boolean; count?: string };
      chain: ChainCall[];
    };

/** `on delete` / `on update` action of a foreign key. */
export type FkAction = "cascade" | "set null" | "set default" | "restrict" | "no action";

/** Parsed schema (built from supabase/migrations/*.sql at server start). */
export interface ColumnDef {
  name: string;
  type: string; // e.g. "uuid", "text", "jsonb", "text[]", "doc_status"
  /** element type for arrays ("uuid" for "uuid[]"), else the same as `type` */
  baseType: string;
  isArray: boolean;
  nullable: boolean;
  /** JS factory for the column default, or undefined when there is none */
  default?: () => unknown;
  /** source text of the default expression (debugging) */
  defaultSql?: string;
  /** serial / identity / nextval() column: name of the sequence (values come from the db's counters) */
  sequence?: string;
  /** foreign key target, if `references public.<table> (<column>)` */
  references?: { table: string; column: string };
}

/** A unique key: PK, `unique` constraint or `create unique index` (parts may be lower()/btrim() expressions). */
export interface UniqueKeyDef {
  name: string;
  primary: boolean;
  parts: { column: string; fns: string[] }[];
  /** partial index predicate (`where …`); undefined = every row */
  where?: (row: Row) => boolean | null;
  /** `nulls not distinct` (default: NULLs never conflict) */
  nullsNotDistinct?: boolean;
  /** key list for error details, e.g. "workspace_id, lower(name)" */
  label: string;
}

/** A CHECK constraint; `test` is undefined when the expression is beyond the evaluator (then it is not enforced). */
export interface CheckDef {
  name: string;
  sql: string;
  test?: (row: Row) => boolean | null;
}

export interface ForeignKeyDef {
  name: string;
  column: string;
  table: string;
  refColumn: string;
  onDelete: FkAction;
  onUpdate: FkAction;
}

export interface TableDef {
  name: string;
  columns: Map<string, ColumnDef>;
  primaryKey: string[];
  /** unique constraints (column sets), incl. single-column `unique` (plain columns only; see uniqueKeys) */
  uniques: string[][];
  /** every unique key incl. the PK and expression / partial unique indexes */
  uniqueKeys: UniqueKeyDef[];
  /** FK constraints as named by Postgres: `<table>_<column>_fkey` → { column, table, refColumn } (public tables only) */
  foreignKeys: ForeignKeyDef[];
  checks: CheckDef[];
}

export interface Schema {
  tables: Map<string, TableDef>;
  enums: Map<string, string[]>;
}

/** Context passed to every RPC implementation. */
export interface RpcContext {
  session: PreviewSession;
  /** run a data query as the given session (same semantics as supabase.from); its writes join the RPC's transaction */
  from: (table: string) => PreviewQueryBuilder;
  /** call another RPC (e.g. bulk_send_claim → bulk_send_settle) inside the same transaction */
  rpc: (fn: string, args?: Record<string, unknown>) => PreviewQueryBuilder;
  /** direct table access (array is the live table; mutate through the helpers); writes join the RPC's transaction */
  db: PreviewDb;
  now: () => string;
  uuid: () => string;
}

/**
 * An RPC returns `{ data, error }` (or throws a `PgException` / PgError-like object, which becomes `error`).
 * Any error rolls back every change the RPC made through `ctx.db` / `ctx.from` (like a plpgsql exception).
 * Return `data: undefined` for `returns void` functions (→ status 204, data null).
 */
export type RpcImpl = (ctx: RpcContext, args: Record<string, unknown>) => Promise<{ data: unknown; error: PgError | null }>;

/** Live in-memory database. */
export interface PreviewDb {
  schema: Schema;
  /** the live table (do not mutate rows in place: use the helpers so constraints, cascades and undo apply) */
  rows(table: string): Row[];
  /** applies defaults + type coercion + constraint checks + triggers; throws PgException (23505, 23503, 23502, 23514, 22P02 …) */
  insert(table: string, row: Row): Row;
  /** inserts several rows atomically (all or nothing) */
  insertMany(table: string, rows: Row[]): Row[];
  /** returns the updated rows (new versions) */
  update(table: string, match: (r: Row) => boolean, patch: Row): Row[];
  /** returns the deleted rows; FK `on delete cascade / set null` and `no action` apply */
  remove(table: string, match: (r: Row) => boolean): Row[];
  /**
   * Runs `fn` atomically: changes made through `tx` are undone when `fn` throws or its promise rejects.
   * (Changes made by other requests meanwhile are kept: this is an undo log, not a snapshot.)
   */
  transaction<T>(fn: (tx: PreviewDb) => T): T;
  uuid(): string;
  now(): string;
  /** free-form state shared with the platform layer (e.g. `seeded: true`); survives HMR */
  meta: Record<string, unknown>;
}

export type CountOption = "exact" | "planned" | "estimated";

/** Surface of the supabase-js query builder (thenable). Every method records a ChainCall. */
export interface PreviewQueryBuilder<T = unknown> extends PromiseLike<PgResult<T>> {
  select(columns?: string, options?: { count?: CountOption; head?: boolean }): PreviewQueryBuilder<T>;
  insert(values: Row | Row[], options?: { count?: CountOption; defaultToNull?: boolean }): PreviewQueryBuilder<T>;
  upsert(
    values: Row | Row[],
    options?: { onConflict?: string; ignoreDuplicates?: boolean; count?: CountOption; defaultToNull?: boolean },
  ): PreviewQueryBuilder<T>;
  update(values: Row, options?: { count?: CountOption }): PreviewQueryBuilder<T>;
  delete(options?: { count?: CountOption }): PreviewQueryBuilder<T>;
  eq(column: string, value: unknown): PreviewQueryBuilder<T>;
  neq(column: string, value: unknown): PreviewQueryBuilder<T>;
  gt(column: string, value: unknown): PreviewQueryBuilder<T>;
  gte(column: string, value: unknown): PreviewQueryBuilder<T>;
  lt(column: string, value: unknown): PreviewQueryBuilder<T>;
  lte(column: string, value: unknown): PreviewQueryBuilder<T>;
  like(column: string, pattern: string): PreviewQueryBuilder<T>;
  ilike(column: string, pattern: string): PreviewQueryBuilder<T>;
  is(column: string, value: boolean | null): PreviewQueryBuilder<T>;
  in(column: string, values: readonly unknown[]): PreviewQueryBuilder<T>;
  contains(column: string, value: unknown): PreviewQueryBuilder<T>;
  containedBy(column: string, value: unknown): PreviewQueryBuilder<T>;
  overlaps(column: string, value: unknown): PreviewQueryBuilder<T>;
  match(query: Record<string, unknown>): PreviewQueryBuilder<T>;
  not(column: string, operator: string, value: unknown): PreviewQueryBuilder<T>;
  or(filters: string, options?: { referencedTable?: string; foreignTable?: string }): PreviewQueryBuilder<T>;
  filter(column: string, operator: string, value: unknown): PreviewQueryBuilder<T>;
  order(
    column: string,
    options?: { ascending?: boolean; nullsFirst?: boolean; referencedTable?: string; foreignTable?: string },
  ): PreviewQueryBuilder<T>;
  limit(count: number, options?: { referencedTable?: string; foreignTable?: string }): PreviewQueryBuilder<T>;
  range(from: number, to: number, options?: { referencedTable?: string; foreignTable?: string }): PreviewQueryBuilder<T>;
  single(): PreviewQueryBuilder<T>;
  maybeSingle(): PreviewQueryBuilder<T>;
  throwOnError(): PreviewQueryBuilder<T>;
  returns<U>(): PreviewQueryBuilder<U>;
  overrideTypes<U>(): PreviewQueryBuilder<U>;
  likeAllOf(column: string, patterns: readonly string[]): PreviewQueryBuilder<T>;
  likeAnyOf(column: string, patterns: readonly string[]): PreviewQueryBuilder<T>;
  ilikeAllOf(column: string, patterns: readonly string[]): PreviewQueryBuilder<T>;
  ilikeAnyOf(column: string, patterns: readonly string[]): PreviewQueryBuilder<T>;
  regexMatch(column: string, pattern: string): PreviewQueryBuilder<T>;
  regexIMatch(column: string, pattern: string): PreviewQueryBuilder<T>;
  isDistinct(column: string, value: unknown): PreviewQueryBuilder<T>;
  notIn(column: string, values: readonly unknown[]): PreviewQueryBuilder<T>;
  textSearch(column: string, query: string, options?: { config?: string; type?: "plain" | "phrase" | "websearch" }): PreviewQueryBuilder<T>;
  csv(): PreviewQueryBuilder<T>;
  stripNulls(): PreviewQueryBuilder<T>;
  rollback(): PreviewQueryBuilder<T>;
  maxAffected(rows: number): PreviewQueryBuilder<T>;
  abortSignal(signal: AbortSignal): PreviewQueryBuilder<T>;
  catch<R = never>(onrejected?: ((reason: unknown) => R | PromiseLike<R>) | null): Promise<PgResult<T> | R>;
  finally(onfinally?: (() => void) | null): Promise<PgResult<T>>;
  [method: string]: unknown;
}

/** Cookie adapter (next/headers cookies() on the server, document.cookie in the browser is NOT used). */
export interface CookieAdapter {
  get(name: string): string | undefined;
  set(name: string, value: string, options?: { maxAge?: number; path?: string; httpOnly?: boolean; sameSite?: "lax" | "strict" }): void;
}

export const PREVIEW_SESSION_COOKIE = "mc_preview_uid";
