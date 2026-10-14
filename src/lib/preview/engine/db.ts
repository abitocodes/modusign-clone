/**
 * In-memory Postgres-ish database of preview mode.
 *
 *  * state lives on `globalThis.__mcPreview.db` so it survives HMR and is shared by every Next.js
 *    module layer (RSC, SSR, route handlers); `getPreviewDb()` returns a fresh view over it
 *  * every mutation applies column defaults / sequences, type coercion, NOT NULL, CHECK, UNIQUE
 *    (incl. lower()/btrim() expression and partial indexes) and FK checks, runs row triggers and
 *    FK `on delete cascade | set null | set default | no action | restrict`
 *  * statements are atomic and `transaction()` gives all-or-nothing semantics through an undo log
 *    (copy-on-write rows: an update replaces the row object, so undo is exact and concurrent
 *    writes of other requests are never clobbered)
 */
import type { ColumnDef, ForeignKeyDef, PreviewDb, PreviewSession, Row, Schema, TableDef, UniqueKeyDef } from "../types";
import { PgException } from "./errors";
import { loadSchemaFromDir } from "./schema";
import { SqlUnsupported } from "./sqlexpr";
import { BUILTIN_TRIGGERS } from "./triggers";
import type { TriggerDef, TriggerOp } from "./triggers";
import { clone, nowIso, uuid } from "./util";
import { coerceWrite, textForm } from "./values";

export interface DbState {
  schema: Schema;
  tables: Map<string, Row[]>;
  seq: Map<string, number>;
  meta: Record<string, unknown>;
  /** triggers registered at runtime (built-ins come from the module so HMR updates them) */
  triggers: Map<string, TriggerDef>;
  createdAt: string;
}

export type UndoEntry =
  | { k: "ins"; table: string; row: Row }
  | { k: "upd"; table: string; before: Row; after: Row }
  | { k: "del"; table: string; row: Row; index: number };

export interface DbContext {
  session?: PreviewSession;
}

export interface PreviewGlobals {
  db?: DbState;
  /** seed hook run once whenever the state is (re)created */
  dbInit?: (db: PreviewDb) => void;
  [key: string]: unknown;
}

/** The HMR-safe container on globalThis (platform modules may keep their own state on it too). */
export function previewGlobals(): PreviewGlobals {
  const g = globalThis as { __mcPreview?: PreviewGlobals };
  if (!g.__mcPreview) g.__mcPreview = {};
  return g.__mcPreview;
}

export function createDbState(schema: Schema): DbState {
  const tables = new Map<string, Row[]>();
  for (const name of schema.tables.keys()) tables.set(name, []);
  return { schema, tables, seq: new Map(), meta: {}, triggers: new Map(), createdAt: nowIso() };
}

const warnedChecks = new Set<string>();

function short(v: unknown): string {
  if (v === null || v === undefined) return "null";
  const s = textForm(v);
  return s.length > 80 ? `${s.slice(0, 77)}...` : s;
}

function failingRow(t: TableDef, row: Row): string {
  return `Failing row contains (${[...t.columns.keys()].map((c) => short(row[c])).join(", ")}).`;
}

function applyKeyFn(fn: string, v: unknown): unknown {
  const s = typeof v === "string" ? v : textForm(v);
  if (fn === "lower") return s.toLowerCase();
  if (fn === "upper") return s.toUpperCase();
  if (fn === "btrim") return s.replace(/^ +| +$/g, "");
  return v;
}

function uniqueKeyOf(u: UniqueKeyDef, row: Row): { key: string; values: unknown[] } | null {
  if (u.where) {
    let ok: boolean | null;
    try {
      ok = u.where(row);
    } catch {
      ok = null; // predicate beyond the evaluator: do not enforce
    }
    if (ok !== true) return null;
  }
  const values: unknown[] = [];
  for (const p of u.parts) {
    let v = row[p.column];
    if (v === null || v === undefined) {
      if (!u.nullsNotDistinct) return null;
      values.push(null);
      continue;
    }
    for (const fn of p.fns) v = applyKeyFn(fn, v);
    values.push(v);
  }
  return { key: JSON.stringify(values), values };
}

function undo(state: DbState, log: UndoEntry[]) {
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i];
    const arr = state.tables.get(e.table);
    if (!arr) continue;
    if (e.k === "ins") {
      const at = arr.indexOf(e.row);
      if (at >= 0) arr.splice(at, 1);
    } else if (e.k === "upd") {
      const at = arr.indexOf(e.after);
      if (at >= 0) arr[at] = e.before;
    } else {
      arr.splice(Math.min(e.index, arr.length), 0, e.row);
    }
  }
  log.length = 0;
}

function isThenable(v: unknown): v is PromiseLike<unknown> {
  return !!v && (typeof v === "object" || typeof v === "function") && typeof (v as { then?: unknown }).then === "function";
}

export interface UpsertOptions {
  /** conflict target columns (default: primary key) */
  onConflict?: string[];
  ignoreDuplicates?: boolean;
}

/**
 * A view over the shared state. Views created by `transaction()` / statements carry an undo log
 * that their changes are appended to.
 */
export class Db implements PreviewDb {
  state: DbState;
  log: UndoEntry[] | null;
  ctx: DbContext;

  constructor(state: DbState, log: UndoEntry[] | null = null, ctx: DbContext = {}) {
    this.state = state;
    this.log = log;
    this.ctx = ctx;
  }

  get schema(): Schema {
    return this.state.schema;
  }
  get meta(): Record<string, unknown> {
    return this.state.meta;
  }

  /** same state + log, other session (for triggers that look at the caller) */
  withSession(session: PreviewSession | undefined): Db {
    return new Db(this.state, this.log, { ...this.ctx, session });
  }

  uuid(): string {
    return uuid();
  }
  now(): string {
    return nowIso();
  }

  tableDef(name: string): TableDef {
    const t = this.state.schema.tables.get(name);
    if (!t) throw new PgException(`relation "public.${name}" does not exist`, "42P01");
    return t;
  }

  rows(table: string): Row[] {
    this.tableDef(table);
    let arr = this.state.tables.get(table);
    if (!arr) {
      arr = [];
      this.state.tables.set(table, arr);
    }
    return arr;
  }

  nextSequence(name: string): number {
    const v = (this.state.seq.get(name) ?? 0) + 1;
    this.state.seq.set(name, v);
    return v;
  }

  // --- public PreviewDb API -------------------------------------------------------------------
  insert(table: string, row: Row): Row {
    return this.insertRows(table, [row])[0];
  }

  insertMany(table: string, rows: Row[]): Row[] {
    return this.insertRows(table, rows);
  }

  update(table: string, match: (r: Row) => boolean, patch: Row): Row[] {
    return this.atomic((log) => this._update(table, match, patch, log));
  }

  remove(table: string, match: (r: Row) => boolean): Row[] {
    return this.atomic((log) => this._remove(table, match, log));
  }

  insertRows(table: string, rows: Row[]): Row[] {
    return this.atomic((log) => {
      const out: Row[] = [];
      for (const r of rows) {
        const inserted = this._insert(table, r, log);
        if (inserted) out.push(inserted);
      }
      return out;
    });
  }

  /** INSERT … ON CONFLICT (cols) DO UPDATE SET <payload columns> = EXCLUDED… | DO NOTHING */
  upsertRows(table: string, rows: Row[], opts: UpsertOptions = {}): Row[] {
    return this.atomic((log) => {
      const t = this.tableDef(table);
      const target = opts.onConflict?.length ? opts.onConflict : t.primaryKey;
      const arbiter = t.uniqueKeys.find(
        (u) =>
          !u.where &&
          u.parts.length === target.length &&
          u.parts.every((p) => p.fns.length === 0) &&
          target.every((c) => u.parts.some((p) => p.column === c)),
      );
      if (!target.length || !arbiter) {
        throw new PgException("there is no unique or exclusion constraint matching the ON CONFLICT specification", "42P10");
      }
      const out: Row[] = [];
      for (const input of rows) {
        const proposed = this.buildRow(t, input);
        const k = uniqueKeyOf(arbiter, proposed);
        const existing = k ? this.rows(table).find((r) => uniqueKeyOf(arbiter, r)?.key === k.key) : undefined;
        if (existing) {
          if (opts.ignoreDuplicates) continue;
          const patch: Row = {};
          for (const key of Object.keys(input)) patch[key] = proposed[key];
          const updated = this._update(table, (r) => r === existing, patch, log, true);
          out.push(...updated);
        } else {
          const inserted = this._insertBuilt(t, proposed, log);
          if (inserted) out.push(inserted);
        }
      }
      return out;
    });
  }

  transaction<T>(fn: (tx: PreviewDb) => T): T {
    const txLog: UndoEntry[] = [];
    const tx = new Db(this.state, txLog, this.ctx);
    const commit = () => {
      if (this.log) this.log.push(...txLog);
    };
    let result: T;
    try {
      result = fn(tx);
    } catch (e) {
      undo(this.state, txLog);
      throw e;
    }
    if (isThenable(result)) {
      return Promise.resolve(result).then(
        (v) => {
          commit();
          return v;
        },
        (e) => {
          undo(this.state, txLog);
          throw e;
        },
      ) as T;
    }
    commit();
    return result;
  }

  /** Runs `fn` as one statement: all its changes or none. */
  atomic<T>(fn: (log: UndoEntry[]) => T): T {
    const log: UndoEntry[] = [];
    try {
      const r = fn(log);
      if (this.log) this.log.push(...log);
      return r;
    } catch (e) {
      undo(this.state, log);
      throw e;
    }
  }

  // --- internals ------------------------------------------------------------------------------
  private triggers(table: string, timing: "before" | "after", op: TriggerOp): TriggerDef[] {
    const all = [...BUILTIN_TRIGGERS, ...this.state.triggers.values()];
    return all.filter((tr) => tr.table === table && tr.timing === timing && tr.events.includes(op)).sort((a, b) => (a.name < b.name ? -1 : 1));
  }

  /**
   * BEFORE row triggers. Returns the (possibly replaced and re-coerced) NEW row for insert/update,
   * `true` to go on with a delete, or `null` when a trigger skipped the row.
   */
  private runBefore(t: TableDef, op: TriggerOp, oldRow: Row | null, newRow: Row | null, log: UndoEntry[]): Row | true | null {
    let cur = newRow;
    let replaced = false;
    for (const tr of this.triggers(t.name, "before", op)) {
      const view = new Db(this.state, log, this.ctx);
      const r = tr.fn({ db: view, table: t.name, op, old: oldRow ? clone(oldRow) : null, new: cur ? clone(cur) : null, session: this.ctx.session });
      if (r === null) return null;
      if (r && typeof r === "object" && op !== "delete") {
        cur = r;
        replaced = true;
      }
    }
    if (op === "delete") return true;
    if (!cur) return null;
    return replaced ? this.recoerce(t, cur) : cur;
  }

  private runAfter(t: TableDef, op: TriggerOp, oldRow: Row | null, newRow: Row | null, log: UndoEntry[]) {
    for (const tr of this.triggers(t.name, "after", op)) {
      const view = new Db(this.state, log, this.ctx);
      tr.fn({ db: view, table: t.name, op, old: oldRow ? clone(oldRow) : null, new: newRow ? clone(newRow) : null, session: this.ctx.session });
    }
  }

  private checkColumns(t: TableDef, input: Row) {
    for (const k of Object.keys(input)) {
      if (!t.columns.has(k)) {
        throw new PgException(`Could not find the '${k}' column of '${t.name}' in the schema cache`, "PGRST204");
      }
    }
  }

  /** Proposed row for an insert: coerced input + defaults + sequences (no constraint checks yet). */
  buildRow(t: TableDef, input: Row): Row {
    this.checkColumns(t, input);
    const row: Row = {};
    for (const col of t.columns.values()) {
      if (Object.prototype.hasOwnProperty.call(input, col.name) && input[col.name] !== undefined) {
        row[col.name] = coerceWrite(col, input[col.name], this.state.schema);
      } else if (col.sequence) {
        row[col.name] = this.nextSequence(col.sequence);
      } else if (col.default) {
        row[col.name] = col.default();
      } else {
        row[col.name] = null;
      }
    }
    return row;
  }

  private validateRow(t: TableDef, row: Row, self: Row | null) {
    // NOT NULL
    for (const col of t.columns.values()) {
      if (!col.nullable && (row[col.name] === null || row[col.name] === undefined)) {
        throw new PgException(`null value in column "${col.name}" of relation "${t.name}" violates not-null constraint`, "23502", failingRow(t, row));
      }
    }
    // CHECK (a check passes unless it is false)
    for (const c of t.checks) {
      if (!c.test) continue;
      let ok: boolean | null;
      try {
        ok = c.test(row);
      } catch (e) {
        const id = `${t.name}.${c.name}`;
        if (!warnedChecks.has(id)) {
          warnedChecks.add(id);
          console.warn(`[preview] check ${id} skipped: ${(e as Error).message}${e instanceof SqlUnsupported ? "" : " (evaluation error)"}`);
        }
        continue;
      }
      if (ok === false) {
        throw new PgException(`new row for relation "${t.name}" violates check constraint "${c.name}"`, "23514", failingRow(t, row));
      }
    }
    // UNIQUE / PK
    const rows = this.rows(t.name);
    for (const u of t.uniqueKeys) {
      const k = uniqueKeyOf(u, row);
      if (!k) continue;
      const clash = rows.find((r) => r !== self && uniqueKeyOf(u, r)?.key === k.key);
      if (clash) {
        throw new PgException(
          `duplicate key value violates unique constraint "${u.name}"`,
          "23505",
          `Key (${u.label})=(${k.values.map(short).join(", ")}) already exists.`,
        );
      }
    }
    // FK (referenced row must exist)
    for (const fk of t.foreignKeys) {
      const v = row[fk.column];
      if (v === null || v === undefined) continue;
      if (self && self[fk.column] === v) continue; // unchanged
      const target = this.state.tables.get(fk.table) ?? [];
      if (!target.some((r) => r[fk.refColumn] === v)) {
        throw new PgException(
          `insert or update on table "${t.name}" violates foreign key constraint "${fk.name}"`,
          "23503",
          `Key (${fk.column})=(${short(v)}) is not present in table "${fk.table}".`,
        );
      }
    }
  }

  private _insert(table: string, input: Row, log: UndoEntry[]): Row | null {
    const t = this.tableDef(table);
    return this._insertBuilt(t, this.buildRow(t, input), log);
  }

  private _insertBuilt(t: TableDef, built: Row, log: UndoEntry[]): Row | null {
    const row = this.runBefore(t, "insert", null, built, log);
    if (!row || row === true) return null;
    this.validateRow(t, row, null);
    this.rows(t.name).push(row);
    log.push({ k: "ins", table: t.name, row });
    this.runAfter(t, "insert", null, row, log);
    return row;
  }

  /** Coerces a row returned by a trigger (keeps canonical forms). */
  private recoerce(t: TableDef, row: Row): Row {
    const out: Row = {};
    for (const col of t.columns.values()) out[col.name] = row[col.name] === undefined ? null : coerceWrite(col, row[col.name], this.state.schema);
    return out;
  }

  private _update(table: string, match: (r: Row) => boolean, patch: Row, log: UndoEntry[], prepared = false): Row[] {
    const t = this.tableDef(table);
    this.checkColumns(t, patch);
    const coerced: Row = {};
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      coerced[k] = prepared ? v : coerceWrite(t.columns.get(k) as ColumnDef, v, this.state.schema);
    }
    const arr = this.rows(table);
    const targets = arr.filter((r) => match(r));
    const out: Row[] = [];
    for (const before of targets) {
      if (arr.indexOf(before) < 0) continue; // removed meanwhile (trigger / cascade)
      const next = this.runBefore(t, "update", before, { ...before, ...clone(coerced) }, log);
      if (!next || next === true) continue;
      this.validateRow(t, next, before);
      const at = arr.indexOf(before);
      if (at < 0) continue;
      arr[at] = next;
      log.push({ k: "upd", table, before, after: next });
      this.applyReferencedKeyChange(t, before, next, log);
      this.runAfter(t, "update", before, next, log);
      out.push(next);
    }
    return out;
  }

  /** FKs of other tables pointing at a changed key column of `t` (on update …). */
  private applyReferencedKeyChange(t: TableDef, before: Row, after: Row, log: UndoEntry[]) {
    for (const [childName, child] of this.state.schema.tables) {
      for (const fk of child.foreignKeys) {
        if (fk.table !== t.name) continue;
        const oldV = before[fk.refColumn];
        const newV = after[fk.refColumn];
        if (oldV === newV || oldV === null || oldV === undefined) continue;
        const refs = (this.state.tables.get(childName) ?? []).filter((r) => r[fk.column] === oldV);
        if (!refs.length) continue;
        this.applyFkAction(fk, fk.onUpdate, childName, child, refs, oldV, newV, log, "update");
      }
    }
  }

  private applyFkAction(
    fk: ForeignKeyDef,
    action: ForeignKeyDef["onDelete"],
    childName: string,
    child: TableDef,
    refs: Row[],
    oldV: unknown,
    newV: unknown,
    log: UndoEntry[],
    op: "update" | "delete",
  ) {
    const set = new Set(refs);
    if (action === "cascade") {
      if (op === "delete") this._remove(childName, (r) => set.has(r), log);
      else this._update(childName, (r) => set.has(r), { [fk.column]: newV }, log, true);
      return;
    }
    if (action === "set null") {
      this._update(childName, (r) => set.has(r), { [fk.column]: null }, log, true);
      return;
    }
    if (action === "set default") {
      const col = child.columns.get(fk.column);
      this._update(childName, (r) => set.has(r), { [fk.column]: col?.default ? col.default() : null }, log, true);
      return;
    }
    throw new PgException(
      `update or delete on table "${fk.table}" violates foreign key constraint "${fk.name}" on table "${childName}"`,
      "23503",
      `Key (${fk.refColumn})=(${short(oldV)}) is still referenced from table "${childName}".`,
    );
  }

  private _remove(table: string, match: (r: Row) => boolean, log: UndoEntry[]): Row[] {
    const t = this.tableDef(table);
    const arr = this.rows(table);
    const targets = arr.filter((r) => match(r));
    const out: Row[] = [];
    for (const row of targets) {
      if (arr.indexOf(row) < 0) continue; // already removed by a cascade
      if (!this.runBefore(t, "delete", row, null, log)) continue;
      const at = arr.indexOf(row);
      if (at < 0) continue;
      arr.splice(at, 1);
      log.push({ k: "del", table, row, index: at });
      // referencing rows
      for (const [childName, child] of this.state.schema.tables) {
        for (const fk of child.foreignKeys) {
          if (fk.table !== table) continue;
          const v = row[fk.refColumn];
          if (v === null || v === undefined) continue;
          const refs = (this.state.tables.get(childName) ?? []).filter((r) => r[fk.column] === v);
          if (!refs.length) continue;
          this.applyFkAction(fk, fk.onDelete, childName, child, refs, v, null, log, "delete");
        }
      }
      this.runAfter(t, "delete", row, null, log);
      out.push(row);
    }
    return out;
  }
}

function isDbState(v: unknown): v is DbState {
  return !!v && typeof v === "object" && (v as DbState).tables instanceof Map && (v as DbState).schema?.tables instanceof Map;
}

/**
 * A `Db` over the same state as `db` (also accepts a view made by an older copy of this module
 * after HMR, which fails `instanceof`). Returns null for anything else.
 */
export function asEngineDb(db: unknown): Db | null {
  if (db instanceof Db) return db;
  const st = (db as { state?: unknown } | null)?.state;
  if (isDbState(st)) {
    const log = (db as { log?: UndoEntry[] | null }).log ?? null;
    return new Db(st, Array.isArray(log) ? log : null, (db as { ctx?: DbContext }).ctx ?? {});
  }
  return null;
}

/** Registers (or replaces, by name) a runtime trigger on the shared state. */
export function registerTrigger(trigger: TriggerDef, db?: PreviewDb): void {
  const state = db ? asEngineDb(db)?.state : previewGlobals().db;
  if (!state) throw new Error("[preview] registerTrigger: database not created yet (call getPreviewDb() first)");
  state.triggers.set(trigger.name, trigger);
}

/** Standalone database (tests, scripts). */
export function createPreviewDb(schema: Schema): Db {
  return new Db(createDbState(schema));
}

const INIT_FLAG = "__engineInitDone";

/**
 * The shared preview database. Created on first use from supabase/migrations; `init` (kept for
 * later re-creations) seeds it synchronously — also when the state already existed without a
 * seed. A throwing `init` discards the state so the next call starts over.
 */
export function getPreviewDb(init?: (db: PreviewDb) => void): Db {
  const g = previewGlobals();
  if (init) g.dbInit = init;
  if (!g.db) g.db = createDbState(loadSchemaFromDir());
  const state = g.db;
  if (g.dbInit && !state.meta[INIT_FLAG]) {
    state.meta[INIT_FLAG] = true;
    try {
      g.dbInit(new Db(state));
    } catch (e) {
      if (g.db === state) delete g.db;
      throw e;
    }
  }
  return new Db(state);
}

/** Drops all data; the next getPreviewDb() re-creates the schema and runs the seed again. */
export function resetPreviewDb(): void {
  delete previewGlobals().db;
}
