/**
 * Builds the preview `Schema` from `supabase/migrations/*.sql` (applied in file-name order).
 *
 * Handled: create type … as enum / alter type … add value · create table [if not exists] (columns,
 * inline + table constraints) · alter table … add/drop/alter column (set/drop default, set/drop not
 * null, type), add/drop constraint (primary key, unique, foreign key, check), rename · create unique
 * index (plain columns and lower()/btrim()/upper() expressions, partial `where`) · drop table/index/type.
 * Ignored: policies, functions, triggers, grants, DO blocks, comments, storage/auth schema objects.
 * Only `public` tables are modelled (FKs to auth.users etc. are dropped).
 */
import type { CheckDef, ColumnDef, FkAction, ForeignKeyDef, Schema, TableDef, UniqueKeyDef } from "../types";
import { SqlUnsupported, compilePredicate, evaluate, normalizeType, parseExpr, readTypeName, splitStatements, tokenize, tokensToSql } from "./sqlexpr";
import type { Expr, Tok } from "./sqlexpr";
import { coerceFilterText, coerceWrite } from "./values";

export interface MigrationFile {
  name: string;
  sql: string;
}

/** Problems found while parsing (unsupported defaults/checks/indexes); also printed with console.warn when `warn` is set. */
export interface SchemaIssues {
  warnings: string[];
}

const SERIAL_TYPES = new Set(["serial", "serial4", "bigserial", "serial8", "smallserial", "serial2"]);

// ---------------------------------------------------------------------------------------------
// token helpers
// ---------------------------------------------------------------------------------------------

function isKw(t: Tok | undefined, v: string) {
  return !!t && t.t === "id" && t.v === v;
}
function isP(t: Tok | undefined, v: string) {
  return !!t && t.t === "p" && t.v === v;
}
function isName(t: Tok | undefined) {
  return !!t && (t.t === "id" || t.t === "qid");
}

/** Index of the `)` matching the `(` at `open`. */
function matchParen(toks: Tok[], open: number): number {
  let depth = 0;
  for (let i = open; i < toks.length; i++) {
    if (isP(toks[i], "(") || isP(toks[i], "[")) depth++;
    else if (isP(toks[i], ")") || isP(toks[i], "]")) {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw new SqlUnsupported("unbalanced parentheses");
}

/** Splits tokens on top-level commas. */
function splitCommas(toks: Tok[]): Tok[][] {
  const out: Tok[][] = [];
  let cur: Tok[] = [];
  let depth = 0;
  for (const t of toks) {
    if (isP(t, "(") || isP(t, "[")) depth++;
    else if (isP(t, ")") || isP(t, "]")) depth--;
    if (depth === 0 && isP(t, ",")) {
      out.push(cur);
      cur = [];
    } else cur.push(t);
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Reads `[schema.]name` at i. */
function readQName(toks: Tok[], i: number): { schema: string | null; name: string; next: number } {
  if (!isName(toks[i])) throw new SqlUnsupported("name expected");
  if (isP(toks[i + 1], ".") && isName(toks[i + 2])) {
    return { schema: toks[i].v, name: toks[i + 2].v, next: i + 3 };
  }
  return { schema: null, name: toks[i].v, next: i + 1 };
}

/** Reads `( a, b )` identifier list at i. */
function readNameList(toks: Tok[], i: number): { names: string[]; next: number } {
  if (!isP(toks[i], "(")) throw new SqlUnsupported("( expected");
  const close = matchParen(toks, i);
  const names = splitCommas(toks.slice(i + 1, close)).map((part) => {
    if (!part.length || !isName(part[0])) throw new SqlUnsupported("column name expected");
    return part[0].v;
  });
  return { names, next: close + 1 };
}

function readFkAction(toks: Tok[], i: number): { action: FkAction; next: number } {
  if (isKw(toks[i], "cascade")) return { action: "cascade", next: i + 1 };
  if (isKw(toks[i], "restrict")) return { action: "restrict", next: i + 1 };
  if (isKw(toks[i], "no") && isKw(toks[i + 1], "action")) return { action: "no action", next: i + 2 };
  if (isKw(toks[i], "set") && isKw(toks[i + 1], "null")) {
    let next = i + 2;
    if (isP(toks[next], "(")) next = matchParen(toks, next) + 1;
    return { action: "set null", next };
  }
  if (isKw(toks[i], "set") && isKw(toks[i + 1], "default")) {
    let next = i + 2;
    if (isP(toks[next], "(")) next = matchParen(toks, next) + 1;
    return { action: "set default", next };
  }
  throw new SqlUnsupported("foreign key action expected");
}

/** Parses `references [schema.]t [(col)] [match …] [on delete …] [on update …] [deferrable …]` starting AFTER `references`. */
function readReferences(toks: Tok[], i: number) {
  const q = readQName(toks, i);
  let next = q.next;
  let refColumn: string | null = null;
  if (isP(toks[next], "(")) {
    const list = readNameList(toks, next);
    if (list.names.length !== 1) throw new SqlUnsupported("multi-column foreign keys");
    refColumn = list.names[0];
    next = list.next;
  }
  let onDelete: FkAction = "no action";
  let onUpdate: FkAction = "no action";
  for (;;) {
    if (isKw(toks[next], "match")) {
      next += 2;
      continue;
    }
    if (isKw(toks[next], "on") && isKw(toks[next + 1], "delete")) {
      const a = readFkAction(toks, next + 2);
      onDelete = a.action;
      next = a.next;
      continue;
    }
    if (isKw(toks[next], "on") && isKw(toks[next + 1], "update")) {
      const a = readFkAction(toks, next + 2);
      onUpdate = a.action;
      next = a.next;
      continue;
    }
    if (isKw(toks[next], "deferrable") || isKw(toks[next], "initially") || (isKw(toks[next], "not") && isKw(toks[next + 1], "deferrable"))) {
      next += isKw(toks[next], "initially") ? 2 : isKw(toks[next], "not") ? 2 : 1;
      continue;
    }
    if (isKw(toks[next], "immediate") || isKw(toks[next], "deferred")) {
      next++;
      continue;
    }
    break;
  }
  return { schema: q.schema, table: q.name, refColumn, onDelete, onUpdate, next };
}

// ---------------------------------------------------------------------------------------------
// builder
// ---------------------------------------------------------------------------------------------

interface PendingFk {
  table: string;
  fk: Omit<ForeignKeyDef, "refColumn"> & { refColumn: string | null };
}

class SchemaBuilder {
  schema: Schema = { tables: new Map(), enums: new Map() };
  warnings: string[] = [];
  file = "";
  /** FKs whose referenced column is the (not yet known) primary key */
  pendingFks: PendingFk[] = [];

  warn(msg: string) {
    this.warnings.push(`${this.file}: ${msg}`);
  }

  table(name: string): TableDef {
    const t = this.schema.tables.get(name);
    if (!t) throw new SqlUnsupported(`unknown table ${name}`);
    return t;
  }

  run(files: MigrationFile[]) {
    const sorted = [...files].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const f of sorted) {
      this.file = f.name;
      const statements = splitStatements(tokenize(f.sql));
      for (const st of statements) {
        try {
          this.statement(st);
        } catch (e) {
          if (e instanceof SqlUnsupported) this.warn(`${e.message} in: ${tokensToSql(st).slice(0, 160)}`);
          else throw e;
        }
      }
    }
    this.finish();
    return this.schema;
  }

  statement(t: Tok[]) {
    if (isKw(t[0], "create")) {
      let i = 1;
      if (isKw(t[i], "or") && isKw(t[i + 1], "replace")) i += 2;
      if (isKw(t[i], "unlogged") || isKw(t[i], "temp") || isKw(t[i], "temporary")) i++;
      if (isKw(t[i], "type")) return this.createType(t, i + 1);
      if (isKw(t[i], "table")) return this.createTable(t, i + 1);
      if (isKw(t[i], "unique") && isKw(t[i + 1], "index")) return this.createIndex(t, i + 2, true);
      if (isKw(t[i], "index")) return; // non-unique indexes do not change semantics
      return;
    }
    if (isKw(t[0], "alter") && isKw(t[1], "table")) return this.alterTable(t, 2);
    if (isKw(t[0], "alter") && isKw(t[1], "type")) return this.alterType(t, 2);
    if (isKw(t[0], "drop") && isKw(t[1], "table")) return this.dropTable(t, 2);
    if (isKw(t[0], "drop") && isKw(t[1], "index")) return this.dropIndex(t, 2);
    if (isKw(t[0], "drop") && isKw(t[1], "type")) return this.dropType(t, 2);
    // everything else (policies, functions, triggers, grants, DO blocks, inserts into storage.*, notify …)
  }

  // --- types --------------------------------------------------------------------------------
  createType(t: Tok[], i: number) {
    const q = readQName(t, i);
    if (!isKw(t[q.next], "as") || !isKw(t[q.next + 1], "enum")) return; // composite / range types: ignore
    const open = q.next + 2;
    const close = matchParen(t, open);
    const values = t.slice(open + 1, close).filter((x) => x.t === "str").map((x) => x.v);
    this.schema.enums.set(q.name, values);
  }

  alterType(t: Tok[], i: number) {
    const q = readQName(t, i);
    let j = q.next;
    const values = this.schema.enums.get(q.name);
    if (!values) return;
    if (isKw(t[j], "add") && isKw(t[j + 1], "value")) {
      j += 2;
      if (isKw(t[j], "if") && isKw(t[j + 1], "not") && isKw(t[j + 2], "exists")) j += 3;
      const v = t[j]?.t === "str" ? t[j].v : null;
      if (!v) return;
      if (values.includes(v)) return;
      j++;
      if ((isKw(t[j], "before") || isKw(t[j], "after")) && t[j + 1]?.t === "str") {
        const at = values.indexOf(t[j + 1].v);
        if (at >= 0) {
          values.splice(isKw(t[j], "before") ? at : at + 1, 0, v);
          return;
        }
      }
      values.push(v);
    } else if (isKw(t[j], "rename") && isKw(t[j + 1], "value") && t[j + 2]?.t === "str" && isKw(t[j + 3], "to") && t[j + 4]?.t === "str") {
      const at = values.indexOf(t[j + 2].v);
      if (at >= 0) values[at] = t[j + 4].v;
    }
  }

  dropType(t: Tok[], i: number) {
    if (isKw(t[i], "if") && isKw(t[i + 1], "exists")) i += 2;
    for (const part of splitCommas(t.slice(i))) {
      const q = readQName(part, 0);
      this.schema.enums.delete(q.name);
    }
  }

  // --- tables -------------------------------------------------------------------------------
  createTable(t: Tok[], i: number) {
    let ifNotExists = false;
    if (isKw(t[i], "if") && isKw(t[i + 1], "not") && isKw(t[i + 2], "exists")) {
      ifNotExists = true;
      i += 3;
    }
    const q = readQName(t, i);
    if (q.schema && q.schema !== "public") return;
    if (this.schema.tables.has(q.name) && ifNotExists) return;
    if (!isP(t[q.next], "(")) throw new SqlUnsupported("create table without column list");
    const close = matchParen(t, q.next);
    const table: TableDef = {
      name: q.name,
      columns: new Map(),
      primaryKey: [],
      uniques: [],
      uniqueKeys: [],
      foreignKeys: [],
      checks: [],
    };
    this.schema.tables.set(q.name, table);
    for (const el of splitCommas(t.slice(q.next + 1, close))) {
      if (!el.length) continue;
      if (this.isTableConstraint(el)) this.tableConstraint(table, el, 0);
      else if (isKw(el[0], "like")) throw new SqlUnsupported("create table (like …)");
      else this.columnDef(table, el);
    }
  }

  isTableConstraint(el: Tok[]) {
    const a = el[0];
    if (!a || a.t !== "id") return false;
    if (a.v === "constraint" || a.v === "check" || a.v === "exclude") return true;
    if (a.v === "primary" && isKw(el[1], "key")) return true;
    if (a.v === "unique" && (isP(el[1], "(") || isKw(el[1], "nulls"))) return true;
    if (a.v === "foreign" && isKw(el[1], "key")) return true;
    return false;
  }

  /** Table-level constraint starting at el[i] (`constraint name …` | primary key | unique | foreign key | check). */
  tableConstraint(table: TableDef, el: Tok[], i: number) {
    let name: string | null = null;
    if (isKw(el[i], "constraint")) {
      name = el[i + 1].v;
      i += 2;
    }
    if (isKw(el[i], "primary") && isKw(el[i + 1], "key")) {
      const list = readNameList(el, i + 2);
      this.setPrimaryKey(table, list.names, name);
      return;
    }
    if (isKw(el[i], "unique")) {
      let j = i + 1;
      let nnd = false;
      if (isKw(el[j], "nulls") && isKw(el[j + 1], "not") && isKw(el[j + 2], "distinct")) {
        nnd = true;
        j += 3;
      } else if (isKw(el[j], "nulls") && isKw(el[j + 1], "distinct")) j += 2;
      const list = readNameList(el, j);
      this.addUnique(table, list.names, name, nnd);
      return;
    }
    if (isKw(el[i], "foreign") && isKw(el[i + 1], "key")) {
      const list = readNameList(el, i + 2);
      if (list.names.length !== 1) throw new SqlUnsupported("multi-column foreign keys");
      if (!isKw(el[list.next], "references")) throw new SqlUnsupported("references expected");
      const ref = readReferences(el, list.next + 1);
      this.addFk(table, list.names[0], ref, name);
      return;
    }
    if (isKw(el[i], "check")) {
      const open = i + 1;
      const close = matchParen(el, open);
      this.addCheck(table, el.slice(open + 1, close), name ?? `${table.name}_check`);
      return;
    }
    if (isKw(el[i], "exclude")) {
      this.warn(`exclusion constraint on ${table.name} not emulated`);
      return;
    }
    throw new SqlUnsupported("unknown table constraint");
  }

  setPrimaryKey(table: TableDef, cols: string[], name: string | null) {
    table.primaryKey = [...cols];
    for (const c of cols) {
      const col = table.columns.get(c);
      if (col) col.nullable = false;
    }
    table.uniqueKeys = table.uniqueKeys.filter((u) => !u.primary);
    table.uniqueKeys.unshift({
      name: name ?? `${table.name}_pkey`,
      primary: true,
      parts: cols.map((c) => ({ column: c, fns: [] })),
      label: cols.join(", "),
    });
  }

  addUnique(table: TableDef, cols: string[], name: string | null, nullsNotDistinct = false) {
    table.uniqueKeys.push({
      name: name ?? `${table.name}_${cols.join("_")}_key`,
      primary: false,
      parts: cols.map((c) => ({ column: c, fns: [] })),
      label: cols.join(", "),
      ...(nullsNotDistinct ? { nullsNotDistinct: true } : {}),
    });
  }

  addFk(
    table: TableDef,
    column: string,
    ref: { schema: string | null; table: string; refColumn: string | null; onDelete: FkAction; onUpdate: FkAction },
    name: string | null,
  ) {
    if (ref.schema && ref.schema !== "public") return; // auth.users, storage.objects …: not modelled
    const fk = {
      name: name ?? `${table.name}_${column}_fkey`,
      column,
      table: ref.table,
      refColumn: ref.refColumn,
      onDelete: ref.onDelete,
      onUpdate: ref.onUpdate,
    };
    if (fk.refColumn === null) {
      this.pendingFks.push({ table: table.name, fk });
      return;
    }
    table.foreignKeys = table.foreignKeys.filter((f) => f.name !== fk.name);
    table.foreignKeys.push(fk as ForeignKeyDef);
  }

  addCheck(table: TableDef, exprToks: Tok[], name: string) {
    const sql = tokensToSql(exprToks);
    const check: CheckDef = { name, sql };
    try {
      check.test = compilePredicate(exprToks);
    } catch (e) {
      if (!(e instanceof SqlUnsupported)) throw e;
      this.warn(`check constraint ${name} not enforced (${e.message})`);
    }
    table.checks = table.checks.filter((c) => c.name !== name);
    table.checks.push(check);
  }

  columnDef(table: TableDef, el: Tok[]): ColumnDef {
    if (!isName(el[0])) throw new SqlUnsupported("column name expected");
    const name = el[0].v;
    const rawType = el[1]?.t === "id" ? el[1].v : "";
    const typeInfo = readTypeName(el, 1);
    let type = typeInfo.type;
    let sequence: string | undefined;
    if (SERIAL_TYPES.has(rawType)) {
      sequence = `${table.name}_${name}_seq`;
      type = normalizeType(rawType);
    }
    const isArray = type.endsWith("[]");
    const col: ColumnDef = {
      name,
      type,
      baseType: isArray ? type.slice(0, -2) : type,
      isArray,
      nullable: !sequence,
      ...(sequence ? { sequence } : {}),
    };
    table.columns.set(name, col);
    this.columnConstraints(table, col, el, typeInfo.next);
    return col;
  }

  /** Column constraints after the type: not null / null / default / primary key / unique / references / check / generated / collate. */
  columnConstraints(table: TableDef, col: ColumnDef, el: Tok[], i: number) {
    const STOP = new Set(["not", "null", "default", "primary", "unique", "references", "check", "constraint", "generated", "collate", "deferrable", "initially"]);
    let cname: string | null = null;
    while (i < el.length) {
      const tk = el[i];
      if (isKw(tk, "constraint")) {
        cname = el[i + 1]?.v ?? null;
        i += 2;
        continue;
      }
      if (isKw(tk, "not") && isKw(el[i + 1], "null")) {
        col.nullable = false;
        i += 2;
        cname = null;
        continue;
      }
      if (isKw(tk, "null")) {
        col.nullable = true;
        i++;
        cname = null;
        continue;
      }
      if (isKw(tk, "default")) {
        let j = i + 1;
        let depth = 0;
        for (; j < el.length; j++) {
          if (isP(el[j], "(") || isP(el[j], "[")) depth++;
          else if (isP(el[j], ")") || isP(el[j], "]")) depth--;
          else if (depth === 0 && el[j].t === "id" && STOP.has(el[j].v)) {
            // `not` only stops when it starts `not null`
            if (el[j].v === "not" && !isKw(el[j + 1], "null")) continue;
            if (el[j].v === "null" && j === i + 1) continue; // `default null`
            break;
          }
        }
        this.setDefault(table, col, el.slice(i + 1, j));
        i = j;
        cname = null;
        continue;
      }
      if (isKw(tk, "primary") && isKw(el[i + 1], "key")) {
        this.setPrimaryKey(table, [col.name], cname);
        i += 2;
        cname = null;
        continue;
      }
      if (isKw(tk, "unique")) {
        let j = i + 1;
        let nnd = false;
        if (isKw(el[j], "nulls") && isKw(el[j + 1], "not") && isKw(el[j + 2], "distinct")) {
          nnd = true;
          j += 3;
        } else if (isKw(el[j], "nulls") && isKw(el[j + 1], "distinct")) j += 2;
        this.addUnique(table, [col.name], cname, nnd);
        i = j;
        cname = null;
        continue;
      }
      if (isKw(tk, "references")) {
        const ref = readReferences(el, i + 1);
        this.addFk(table, col.name, ref, cname);
        if (!ref.schema || ref.schema === "public") {
          col.references = { table: ref.table, column: ref.refColumn ?? "" };
        }
        i = ref.next;
        cname = null;
        continue;
      }
      if (isKw(tk, "check")) {
        const close = matchParen(el, i + 1);
        this.addCheck(table, el.slice(i + 2, close), cname ?? `${table.name}_${col.name}_check`);
        i = close + 1;
        if (isKw(el[i], "no") && isKw(el[i + 1], "inherit")) i += 2;
        cname = null;
        continue;
      }
      if (isKw(tk, "generated")) {
        // generated always|by default as identity [( … )]  |  generated always as (expr) stored
        let j = i + 1;
        if (isKw(el[j], "always")) j++;
        else if (isKw(el[j], "by") && isKw(el[j + 1], "default")) j += 2;
        if (isKw(el[j], "as") && isKw(el[j + 1], "identity")) {
          col.sequence = `${table.name}_${col.name}_seq`;
          col.nullable = false;
          j += 2;
          if (isP(el[j], "(")) j = matchParen(el, j) + 1;
          i = j;
          continue;
        }
        if (isKw(el[j], "as") && isP(el[j + 1], "(")) {
          this.warn(`generated column ${table.name}.${col.name} is not computed`);
          j = matchParen(el, j + 1) + 1;
          if (isKw(el[j], "stored")) j++;
          i = j;
          continue;
        }
        throw new SqlUnsupported("generated …");
      }
      if (isKw(tk, "collate")) {
        i += 2;
        continue;
      }
      if (isKw(tk, "deferrable") || isKw(tk, "immediate") || isKw(tk, "deferred")) {
        i++;
        continue;
      }
      if (isKw(tk, "initially")) {
        i += 2;
        continue;
      }
      throw new SqlUnsupported(`unexpected "${tk.v}" in column ${col.name}`);
    }
  }

  setDefault(table: TableDef, col: ColumnDef, exprToks: Tok[]) {
    const sql = tokensToSql(exprToks);
    col.defaultSql = sql;
    delete col.default;
    // nextval('seq') → sequence-backed column
    if (isKw(exprToks[0], "nextval")) {
      const s = exprToks.find((x) => x.t === "str");
      col.sequence = s ? s.v.replace(/^public\./, "").replace(/::regclass$/, "") : `${table.name}_${col.name}_seq`;
      return;
    }
    let expr: Expr;
    try {
      expr = parseExpr(exprToks);
    } catch (e) {
      if (!(e instanceof SqlUnsupported)) throw e;
      this.warn(`default of ${table.name}.${col.name} not supported (${sql}): ${e.message}`);
      return;
    }
    if (expr.k === "lit" && expr.v === null) return; // default null = no default
    const schema = this.schema;
    const noColumns = {
      col(name: string): unknown {
        throw new SqlUnsupported(`column reference ${name} in a default`);
      },
    };
    const factory =
      expr.k === "lit" && typeof expr.v === "string"
        ? (() => {
            const text = expr.v;
            // an untyped literal takes the column's type ('{}' → [], '{}' for jsonb → {}, 'team' → enum)
            return () => coerceFilterText(col, text, schema);
          })()
        : () => coerceWrite(col, evaluate(expr, noColumns), schema);
    col.default = factory;
  }

  alterTable(t: Tok[], i: number) {
    if (isKw(t[i], "if") && isKw(t[i + 1], "exists")) i += 2;
    if (isKw(t[i], "only")) i++;
    const q = readQName(t, i);
    if (q.schema && q.schema !== "public") return;
    const table = this.schema.tables.get(q.name);
    if (!table) {
      if (q.schema === null || q.schema === "public") this.warn(`alter table on unknown table ${q.name}`);
      return;
    }
    const j = q.next;
    // rename to <new>
    if (isKw(t[j], "rename") && isKw(t[j + 1], "to") && isName(t[j + 2])) {
      this.renameTable(table, t[j + 2].v);
      return;
    }
    for (const action of splitCommas(t.slice(j))) {
      try {
        this.alterAction(table, action);
      } catch (e) {
        if (e instanceof SqlUnsupported) this.warn(`${e.message} in alter table ${table.name}: ${tokensToSql(action).slice(0, 120)}`);
        else throw e;
      }
    }
  }

  alterAction(table: TableDef, a: Tok[]) {
    if (!a.length) return;
    // ADD …
    if (isKw(a[0], "add")) {
      if (this.isTableConstraint(a.slice(1))) {
        this.tableConstraint(table, a, 1);
        return;
      }
      let i = 1;
      if (isKw(a[i], "column")) i++;
      if (isKw(a[i], "if") && isKw(a[i + 1], "not") && isKw(a[i + 2], "exists")) {
        i += 3;
        if (table.columns.has(a[i]?.v)) return;
      }
      this.columnDef(table, a.slice(i));
      return;
    }
    // DROP …
    if (isKw(a[0], "drop")) {
      if (isKw(a[1], "constraint")) {
        let i = 2;
        if (isKw(a[i], "if") && isKw(a[i + 1], "exists")) i += 2;
        this.dropConstraint(table, a[i].v);
        return;
      }
      let i = 1;
      if (isKw(a[i], "column")) i++;
      if (isKw(a[i], "if") && isKw(a[i + 1], "exists")) i += 2;
      if (!isName(a[i])) return;
      this.dropColumn(table, a[i].v);
      return;
    }
    // ALTER [COLUMN] c …
    if (isKw(a[0], "alter")) {
      let i = 1;
      if (isKw(a[i], "column")) i++;
      if (isKw(a[i], "constraint")) return; // alter constraint … deferrable
      const col = table.columns.get(a[i]?.v);
      if (!col) throw new SqlUnsupported(`unknown column ${a[i]?.v}`);
      i++;
      if (isKw(a[i], "set") && isKw(a[i + 1], "default")) {
        this.setDefault(table, col, a.slice(i + 2));
        return;
      }
      if (isKw(a[i], "drop") && isKw(a[i + 1], "default")) {
        delete col.default;
        delete col.defaultSql;
        delete col.sequence; // a serial column without its nextval() default
        return;
      }
      if (isKw(a[i], "set") && isKw(a[i + 1], "not") && isKw(a[i + 2], "null")) {
        col.nullable = false;
        return;
      }
      if (isKw(a[i], "drop") && isKw(a[i + 1], "not") && isKw(a[i + 2], "null")) {
        col.nullable = true;
        return;
      }
      if ((isKw(a[i], "set") && isKw(a[i + 1], "data") && isKw(a[i + 2], "type")) || isKw(a[i], "type")) {
        const at = isKw(a[i], "type") ? i + 1 : i + 3;
        const ti = readTypeName(a, at);
        col.type = ti.type;
        col.isArray = ti.type.endsWith("[]");
        col.baseType = col.isArray ? ti.type.slice(0, -2) : ti.type;
        return;
      }
      if (isKw(a[i], "add") && isKw(a[i + 1], "generated")) {
        col.sequence = `${table.name}_${col.name}_seq`;
        col.nullable = false;
        return;
      }
      return; // set statistics / storage …
    }
    // RENAME [COLUMN] a TO b | RENAME CONSTRAINT a TO b
    if (isKw(a[0], "rename")) {
      let i = 1;
      if (isKw(a[i], "constraint")) {
        const from = a[i + 1].v;
        const to = a[i + 3].v;
        for (const u of table.uniqueKeys) if (u.name === from) u.name = to;
        for (const f of table.foreignKeys) if (f.name === from) f.name = to;
        for (const c of table.checks) if (c.name === from) c.name = to;
        return;
      }
      if (isKw(a[i], "column")) i++;
      if (isName(a[i]) && isKw(a[i + 1], "to") && isName(a[i + 2])) this.renameColumn(table, a[i].v, a[i + 2].v);
      return;
    }
    // enable/disable/force row level security, owner to, validate constraint, set (…), replica identity …: no effect
  }

  dropConstraint(table: TableDef, name: string) {
    const pk = table.uniqueKeys.find((u) => u.name === name && u.primary);
    if (pk) table.primaryKey = [];
    table.uniqueKeys = table.uniqueKeys.filter((u) => u.name !== name);
    table.foreignKeys = table.foreignKeys.filter((f) => f.name !== name);
    table.checks = table.checks.filter((c) => c.name !== name);
    this.pendingFks = this.pendingFks.filter((p) => !(p.table === table.name && p.fk.name === name));
  }

  dropColumn(table: TableDef, name: string) {
    if (!table.columns.delete(name)) return;
    if (table.primaryKey.includes(name)) table.primaryKey = [];
    table.uniqueKeys = table.uniqueKeys.filter((u) => !u.parts.some((p) => p.column === name));
    table.foreignKeys = table.foreignKeys.filter((f) => f.column !== name);
    table.checks = table.checks.filter((c) => !tokenize(c.sql).some((x) => (x.t === "id" || x.t === "qid") && x.v === name));
    // FKs of other tables that pointed at this column are dropped with it (DROP … CASCADE)
    for (const other of this.schema.tables.values()) {
      other.foreignKeys = other.foreignKeys.filter((f) => !(f.table === table.name && f.refColumn === name));
      for (const c of other.columns.values()) {
        if (c.references?.table === table.name && c.references.column === name) delete c.references;
      }
    }
  }

  renameColumn(table: TableDef, from: string, to: string) {
    const col = table.columns.get(from);
    if (!col) return;
    const entries = [...table.columns.entries()].map(([k, v]) => (k === from ? ([to, v] as const) : ([k, v] as const)));
    col.name = to;
    table.columns = new Map(entries);
    table.primaryKey = table.primaryKey.map((c) => (c === from ? to : c));
    for (const u of table.uniqueKeys) for (const p of u.parts) if (p.column === from) p.column = to;
    for (const f of table.foreignKeys) if (f.column === from) f.column = to;
    for (const other of this.schema.tables.values()) {
      for (const f of other.foreignKeys) if (f.table === table.name && f.refColumn === from) f.refColumn = to;
      for (const c of other.columns.values()) if (c.references?.table === table.name && c.references.column === from) c.references.column = to;
    }
    if (table.checks.length) this.warn(`rename column ${table.name}.${from}: check constraints keep the old name`);
  }

  renameTable(table: TableDef, to: string) {
    const from = table.name;
    this.schema.tables.delete(from);
    table.name = to;
    this.schema.tables.set(to, table);
    for (const other of this.schema.tables.values()) {
      for (const f of other.foreignKeys) if (f.table === from) f.table = to;
      for (const c of other.columns.values()) if (c.references?.table === from) c.references.table = to;
    }
  }

  dropTable(t: Tok[], i: number) {
    if (isKw(t[i], "if") && isKw(t[i + 1], "exists")) i += 2;
    const rest = t.slice(i).filter((x) => !(x.t === "id" && (x.v === "cascade" || x.v === "restrict")));
    for (const part of splitCommas(rest)) {
      if (!part.length) continue;
      const q = readQName(part, 0);
      if (q.schema && q.schema !== "public") continue;
      this.schema.tables.delete(q.name);
      for (const other of this.schema.tables.values()) {
        other.foreignKeys = other.foreignKeys.filter((f) => f.table !== q.name);
      }
    }
  }

  // --- indexes ------------------------------------------------------------------------------
  createIndex(t: Tok[], i: number, unique: boolean) {
    if (!unique) return;
    if (isKw(t[i], "concurrently")) i++;
    if (isKw(t[i], "if") && isKw(t[i + 1], "not") && isKw(t[i + 2], "exists")) i += 3;
    let name: string | null = null;
    if (!isKw(t[i], "on")) {
      const q = readQName(t, i);
      name = q.name;
      i = q.next;
    }
    if (!isKw(t[i], "on")) throw new SqlUnsupported("create index … on expected");
    i++;
    if (isKw(t[i], "only")) i++;
    const q = readQName(t, i);
    if (q.schema && q.schema !== "public") return;
    const table = this.schema.tables.get(q.name);
    if (!table) throw new SqlUnsupported(`index on unknown table ${q.name}`);
    i = q.next;
    if (isKw(t[i], "using")) i += 2;
    if (!isP(t[i], "(")) throw new SqlUnsupported("index column list expected");
    const close = matchParen(t, i);
    const parts: { column: string; fns: string[] }[] = [];
    const labels: string[] = [];
    for (const part of splitCommas(t.slice(i + 1, close))) {
      const p = this.indexPart(table, part);
      parts.push(p);
      labels.push(p.fns.reduce((acc, fn) => `${fn}(${acc})`, p.column));
    }
    i = close + 1;
    let nnd = false;
    let where: ((row: Record<string, unknown>) => boolean | null) | undefined;
    while (i < t.length) {
      if (isKw(t[i], "include") && isP(t[i + 1], "(")) {
        i = matchParen(t, i + 1) + 1;
        continue;
      }
      if (isKw(t[i], "nulls") && isKw(t[i + 1], "not") && isKw(t[i + 2], "distinct")) {
        nnd = true;
        i += 3;
        continue;
      }
      if (isKw(t[i], "nulls") && isKw(t[i + 1], "distinct")) {
        i += 2;
        continue;
      }
      if (isKw(t[i], "with") && isP(t[i + 1], "(")) {
        i = matchParen(t, i + 1) + 1;
        continue;
      }
      if (isKw(t[i], "tablespace")) {
        i += 2;
        continue;
      }
      if (isKw(t[i], "where")) {
        where = compilePredicate(t.slice(i + 1));
        break;
      }
      throw new SqlUnsupported(`unexpected "${t[i].v}" in create index`);
    }
    const key: UniqueKeyDef = {
      name: name ?? `${table.name}_${parts.map((p) => p.column).join("_")}_idx`,
      primary: false,
      parts,
      label: labels.join(", "),
      ...(where ? { where } : {}),
      ...(nnd ? { nullsNotDistinct: true } : {}),
    };
    table.uniqueKeys = table.uniqueKeys.filter((u) => u.name !== key.name);
    table.uniqueKeys.push(key);
  }

  /** `col` | `lower(col)` | `lower(btrim(col))` | `(lower(col))` [opclass] [asc|desc] [nulls first|last] */
  indexPart(table: TableDef, part: Tok[]): { column: string; fns: string[] } {
    let toks = part.filter((x) => !(x.t === "id" && (x.v === "asc" || x.v === "desc")));
    // strip `nulls first|last`
    const nullsAt = toks.findIndex((x, k) => isKw(x, "nulls") && (isKw(toks[k + 1], "first") || isKw(toks[k + 1], "last")));
    if (nullsAt >= 0) toks = [...toks.slice(0, nullsAt), ...toks.slice(nullsAt + 2)];
    // drop a trailing operator class (`jsonb_path_ops`, `text_pattern_ops` …)
    if (toks.length >= 2 && toks[toks.length - 1].t === "id" && !isP(toks[toks.length - 2], ".") && !isP(toks[toks.length - 1], ")")) {
      const last = toks[toks.length - 1].v;
      if (/_ops$/.test(last)) toks = toks.slice(0, -1);
    }
    while (toks.length >= 2 && isP(toks[0], "(") && matchParen(toks, 0) === toks.length - 1) toks = toks.slice(1, -1);
    if (toks.length === 1 && isName(toks[0])) {
      if (!table.columns.has(toks[0].v)) throw new SqlUnsupported(`unknown column ${toks[0].v}`);
      return { column: toks[0].v, fns: [] };
    }
    // nested single-argument functions of one column
    const fns: string[] = [];
    let cur = toks;
    for (;;) {
      if (cur.length === 1 && isName(cur[0])) break;
      if (cur.length >= 3 && cur[0].t === "id" && isP(cur[1], "(") && matchParen(cur, 1) === cur.length - 1) {
        const fn = cur[0].v;
        if (!["lower", "upper", "btrim", "trim"].includes(fn)) throw new SqlUnsupported(`index expression ${fn}()`);
        fns.unshift(fn === "trim" ? "btrim" : fn);
        cur = cur.slice(2, -1);
        continue;
      }
      throw new SqlUnsupported(`index expression ${tokensToSql(part)}`);
    }
    if (!table.columns.has(cur[0].v)) throw new SqlUnsupported(`unknown column ${cur[0].v}`);
    return { column: cur[0].v, fns };
  }

  dropIndex(t: Tok[], i: number) {
    if (isKw(t[i], "concurrently")) i++;
    if (isKw(t[i], "if") && isKw(t[i + 1], "exists")) i += 2;
    const rest = t.slice(i).filter((x) => !(x.t === "id" && (x.v === "cascade" || x.v === "restrict")));
    for (const part of splitCommas(rest)) {
      if (!part.length) continue;
      const q = readQName(part, 0);
      for (const table of this.schema.tables.values()) {
        table.uniqueKeys = table.uniqueKeys.filter((u) => u.primary || u.name !== q.name);
      }
    }
  }

  finish() {
    for (const p of this.pendingFks) {
      const table = this.schema.tables.get(p.table);
      const target = this.schema.tables.get(p.fk.table);
      if (!table || !target) continue;
      if (target.primaryKey.length !== 1) {
        this.warn(`FK ${p.fk.name}: referenced table ${p.fk.table} has no single-column primary key`);
        continue;
      }
      const fk: ForeignKeyDef = { ...p.fk, refColumn: target.primaryKey[0] };
      table.foreignKeys = table.foreignKeys.filter((f) => f.name !== fk.name);
      table.foreignKeys.push(fk);
      const col = table.columns.get(fk.column);
      if (col) col.references = { table: fk.table, column: fk.refColumn };
    }
    this.pendingFks = [];
    for (const table of this.schema.tables.values()) {
      // FK targets that were dropped
      table.foreignKeys = table.foreignKeys.filter((f) => this.schema.tables.has(f.table));
      for (const c of table.columns.values()) {
        if (c.references && !this.schema.tables.has(c.references.table)) delete c.references;
      }
      table.uniques = table.uniqueKeys
        .filter((u) => !u.primary && !u.where && u.parts.every((p) => p.fns.length === 0))
        .map((u) => u.parts.map((p) => p.column));
      // test-evaluate defaults once so broken factories surface at start-up
      for (const c of table.columns.values()) {
        if (!c.default) continue;
        try {
          c.default();
        } catch (e) {
          this.warn(`default of ${table.name}.${c.name} (${c.defaultSql}) failed: ${(e as Error).message}`);
          delete c.default;
        }
      }
    }
  }
}

/** Parses migration files (any order; they are applied sorted by name). */
export function parseSchema(files: MigrationFile[], opts: { warn?: boolean } = {}): Schema & SchemaIssues {
  const b = new SchemaBuilder();
  const schema = b.run(files);
  if (opts.warn !== false) for (const w of b.warnings) console.warn(`[preview] schema: ${w}`);
  return Object.assign(schema, { warnings: b.warnings });
}

type FsLike = {
  readdirSync(p: string): string[];
  readFileSync(p: string, enc: "utf8"): string;
};
type PathLike = { join(...parts: string[]): string };

/**
 * Reads and parses `<cwd>/supabase/migrations/*.sql` (or `dir`). Server-only at runtime, but has no
 * static node imports (uses process.getBuiltinModule) so the module can be imported anywhere.
 */
export function loadSchemaFromDir(dir?: string, opts: { warn?: boolean } = {}): Schema & SchemaIssues {
  const proc = (globalThis as { process?: { cwd(): string; getBuiltinModule?: (id: string) => unknown; env?: Record<string, string | undefined> } }).process;
  if (!proc?.getBuiltinModule) throw new Error("[preview] loadSchemaFromDir needs Node.js ≥ 22.3 (process.getBuiltinModule)");
  const fs = proc.getBuiltinModule("node:fs") as FsLike;
  const path = proc.getBuiltinModule("node:path") as PathLike;
  const root = dir ?? proc.env?.PREVIEW_MIGRATIONS_DIR ?? path.join(proc.cwd(), "supabase", "migrations");
  const files = fs
    .readdirSync(root)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, sql: fs.readFileSync(path.join(root, name), "utf8") }));
  if (!files.length) throw new Error(`[preview] no migrations found in ${root}`);
  return parseSchema(files, opts);
}
