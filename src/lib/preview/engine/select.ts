/**
 * PostgREST `select=` parser, relationship (embed) resolution and row projection.
 *
 * Supported: `*` · `a,b` · `alias:col` · `col::text` · `meta->a->>b` · `rel(…)` · `alias:rel(…)` ·
 * `rel!fkey_or_column(…)` · `rel!inner(…)` / `!left` (combinable) · `...rel(…)` spread ·
 * nested embeds · `rel(count)` / `count()`. Embeds resolve through FKs in both directions:
 * many-to-one → object | null, one-to-one (unique FK on the child) → object | null,
 * one-to-many → array. Ambiguity → PGRST201, no relationship → PGRST200, unknown column → 42703.
 */
import type { ForeignKeyDef, Row, Schema, TableDef } from "../types";
import { PgException } from "./errors";
import { clone } from "./util";
import { textForm } from "./values";

export interface JsonStep {
  key: string;
  /** `->>` (text) instead of `->` (json) */
  asText: boolean;
}

export type SelectItem =
  | { k: "star" }
  | { k: "col"; name: string; alias: string; json: JsonStep[]; cast?: string }
  | { k: "count"; alias: string }
  | { k: "embed"; rel: string; alias: string; hints: string[]; inner: boolean; spread: boolean; items: SelectItem[] };

/** Strips whitespace outside double quotes (what supabase-js does to the select string). */
export function cleanSelect(columns: string | undefined | null): string {
  let quoted = false;
  let out = "";
  for (const c of columns ?? "*") {
    if (/\s/.test(c) && !quoted) continue;
    if (c === '"') quoted = !quoted;
    out += c;
  }
  return out;
}

function parseError(message: string): PgException {
  return new PgException(message, "PGRST100", null, null);
}

class SelectParser {
  s: string;
  i = 0;
  constructor(s: string) {
    this.s = s;
  }
  peek(n = 1) {
    return this.s.slice(this.i, this.i + n);
  }
  eat(t: string) {
    if (this.s.startsWith(t, this.i)) {
      this.i += t.length;
      return true;
    }
    return false;
  }
  ident(): string {
    if (this.peek() === '"') {
      this.i++;
      let v = "";
      while (this.i < this.s.length && this.s[this.i] !== '"') {
        if (this.s[this.i] === "\\" && this.i + 1 < this.s.length) this.i++;
        v += this.s[this.i++];
      }
      if (!this.eat('"')) throw parseError(`"failed to parse select parameter (${this.s})"`);
      return v;
    }
    const tok = /^[A-Za-z0-9_$\u0080-￿]+|^\*/.exec(this.s.slice(this.i))?.[0];
    if (!tok) throw parseError(`failed to parse select parameter (${this.s}) at ${this.i}`);
    this.i += tok.length;
    return tok;
  }
  list(): SelectItem[] {
    const items: SelectItem[] = [];
    if (this.i >= this.s.length || this.peek() === ")") return items;
    for (;;) {
      items.push(this.item());
      if (this.eat(",")) continue;
      break;
    }
    return items;
  }
  item(): SelectItem {
    const spread = this.eat("...");
    if (this.peek() === "*") {
      this.i++;
      if (spread) throw parseError("spread of * is not supported");
      return { k: "star" };
    }
    let alias: string | null = null;
    let name = this.ident();
    if (this.peek() === ":" && this.peek(2) !== "::") {
      this.i++;
      alias = name;
      name = this.ident();
    }
    // count() aggregate
    if (name === "count" && this.peek(2) === "()") {
      this.i += 2;
      return { k: "count", alias: alias ?? "count" };
    }
    // embed
    if (this.peek() === "!" || this.peek() === "(") {
      const hints: string[] = [];
      let inner = false;
      while (this.eat("!")) {
        const h = this.ident();
        if (h === "inner") inner = true;
        else if (h === "left") inner = false;
        else hints.push(h);
      }
      if (!this.eat("(")) throw parseError(`failed to parse select parameter (${this.s}): "(" expected after ${name}`);
      const items = this.list();
      if (!this.eat(")")) throw parseError(`failed to parse select parameter (${this.s}): ")" expected`);
      return { k: "embed", rel: name, alias: alias ?? name, hints, inner, spread, items };
    }
    if (spread) throw parseError("spread is only supported on embedded resources");
    const json: JsonStep[] = [];
    for (;;) {
      if (this.eat("->>")) json.push({ key: this.jsonKey(), asText: true });
      else if (this.eat("->")) json.push({ key: this.jsonKey(), asText: false });
      else break;
    }
    let cast: string | undefined;
    if (this.eat("::")) cast = this.ident().toLowerCase();
    // aggregates like col.sum() are not supported
    if (this.peek() === ".") throw parseError(`aggregate functions are not supported in preview (${this.s})`);
    const defAlias = json.length ? json[json.length - 1].key : name;
    return { k: "col", name, alias: alias ?? defAlias, json, ...(cast ? { cast } : {}) };
  }
  jsonKey(): string {
    if (this.peek() === "'" || this.peek() === '"') {
      const q = this.peek();
      this.i++;
      const end = this.s.indexOf(q, this.i);
      const v = this.s.slice(this.i, end < 0 ? undefined : end);
      this.i = end < 0 ? this.s.length : end + 1;
      return v;
    }
    const m = /^[^,:()!>-]+/.exec(this.s.slice(this.i));
    if (!m) throw parseError(`failed to parse select parameter (${this.s})`);
    this.i += m[0].length;
    return m[0];
  }
}

/** Parses a (cleaned) select string. */
export function parseSelect(select: string): SelectItem[] {
  const s = cleanSelect(select) || "*";
  const p = new SelectParser(s);
  const items = p.list();
  if (p.i !== s.length) throw parseError(`failed to parse select parameter (${s}) at position ${p.i}`);
  return items;
}

// ---------------------------------------------------------------------------------------------
// relationships
// ---------------------------------------------------------------------------------------------

export interface Relation {
  /** embedded table */
  target: string;
  /** many-to-one (parent holds the FK), one-to-many (child holds it), one-to-one (child FK is unique) */
  kind: "m2o" | "o2m" | "o2o";
  fk: ForeignKeyDef;
  /** column of the parent row compared … */
  parentColumn: string;
  /** … with this column of the embedded rows */
  targetColumn: string;
}

function isUniqueColumn(t: TableDef, column: string) {
  return t.uniqueKeys.some((u) => !u.where && u.parts.length === 1 && u.parts[0].column === column && u.parts[0].fns.length === 0);
}

/** Resolves `rel` (table name, FK column or FK name) embedded under `parent`, honouring `!hint`s. */
export function resolveRelation(schema: Schema, parent: string, rel: string, hints: string[]): Relation {
  const p = schema.tables.get(parent);
  if (!p) throw new PgException(`relation "public.${parent}" does not exist`, "42P01");
  const cands: Relation[] = [];
  const target = schema.tables.get(rel);
  if (target) {
    for (const fk of p.foreignKeys) {
      if (fk.table === rel) cands.push({ target: rel, kind: "m2o", fk, parentColumn: fk.column, targetColumn: fk.refColumn });
    }
    for (const fk of target.foreignKeys) {
      if (fk.table === parent) {
        cands.push({
          target: rel,
          kind: isUniqueColumn(target, fk.column) ? "o2o" : "o2m",
          fk,
          parentColumn: fk.refColumn,
          targetColumn: fk.column,
        });
      }
    }
  } else {
    // embedding by FK column (`owner_id(name)`) or by FK constraint name
    for (const fk of p.foreignKeys) {
      if (fk.column === rel || fk.name === rel) cands.push({ target: fk.table, kind: "m2o", fk, parentColumn: fk.column, targetColumn: fk.refColumn });
    }
    for (const [name, t] of schema.tables) {
      for (const fk of t.foreignKeys) {
        if (fk.table === parent && fk.name === rel) {
          cands.push({ target: name, kind: isUniqueColumn(t, fk.column) ? "o2o" : "o2m", fk, parentColumn: fk.refColumn, targetColumn: fk.column });
        }
      }
    }
  }
  let found = cands;
  for (const h of hints) {
    found = found.filter((c) => c.fk.name === h || c.fk.column === h || c.targetColumn === h || c.parentColumn === h);
  }
  // self-references are listed in both directions with the same FK: the hint must pick one, else prefer m2o
  if (found.length === 2 && found[0].fk === found[1].fk && !hints.length) found = found.filter((c) => c.kind === "m2o");
  if (found.length === 1) return found[0];
  if (found.length === 0) {
    throw new PgException(
      `Could not find a relationship between '${parent}' and '${rel}' in the schema cache`,
      "PGRST200",
      hints.length ? `Searched for a foreign key relationship between '${parent}' and '${rel}' using the hint '${hints.join("!")}' in the schema 'public', but no matches were found.` : `Searched for a foreign key relationship between '${parent}' and '${rel}' in the schema 'public', but no matches were found.`,
      null,
    );
  }
  throw new PgException(
    `Could not embed because more than one relationship was found for '${parent}' and '${rel}'`,
    "PGRST201",
    JSON.stringify(found.map((c) => ({ cardinality: c.kind === "m2o" ? "many-to-one" : c.kind === "o2o" ? "one-to-one" : "one-to-many", embedding: `${parent} with ${c.target}`, relationship: `${c.fk.name} using ${parent}(${c.parentColumn}) and ${c.target}(${c.targetColumn})` }))),
    `Try changing '${rel}' to one of the following: ${found.map((c) => `'${rel}!${c.fk.name}'`).join(", ")}. Find the desired relationship in the 'details' key.`,
  );
}

// ---------------------------------------------------------------------------------------------
// plan
// ---------------------------------------------------------------------------------------------

export interface PlanNode {
  table: string;
  items: SelectItem[];
  embeds: EmbedPlan[];
  /** alias path from the root ("participants" → ["participants"]) */
  path: string[];
  /** `count()` / `rel(count)`: the node yields `{ count }` aggregates instead of rows */
  countOnly: boolean;
}

export interface EmbedPlan extends PlanNode {
  item: Extract<SelectItem, { k: "embed" }>;
  rel: Relation;
}

function unknownColumn(table: string, column: string): PgException {
  return new PgException(`column ${table}.${column} does not exist`, "42703");
}

/** Validates the select against the schema and resolves every embed. */
export function buildPlan(schema: Schema, table: string, items: SelectItem[], path: string[] = []): PlanNode {
  const t = schema.tables.get(table);
  if (!t) throw new PgException(`relation "public.${table}" does not exist`, "42P01");
  // legacy `rel(count)`: a bare `count` that is not a column is the count aggregate
  items = items.map((it) => (it.k === "col" && it.name === "count" && !it.json.length && !it.cast && !t.columns.has("count") ? { k: "count", alias: it.alias } : it));
  const embeds: EmbedPlan[] = [];
  for (const it of items) {
    if (it.k === "col") {
      if (!t.columns.has(it.name)) throw unknownColumn(table, it.name);
    } else if (it.k === "embed") {
      const rel = resolveRelation(schema, table, it.rel, it.hints);
      const sub = buildPlan(schema, rel.target, it.items.length ? it.items : [{ k: "star" }], [...path, it.alias]);
      embeds.push({ ...sub, item: it, rel });
    }
  }
  const counts = items.filter((it) => it.k === "count").length;
  if (counts && counts !== items.length) {
    throw new PgException("count() together with other columns (GROUP BY aggregates) is not supported in preview", "PGRST100");
  }
  return { table, items, embeds, path, countOnly: counts > 0 };
}

// ---------------------------------------------------------------------------------------------
// projection
// ---------------------------------------------------------------------------------------------

/** Follows a JSON path (`->` / `->>`) from a column value. */
export function jsonPathValue(v: unknown, steps: JsonStep[]): unknown {
  let cur = v;
  for (const st of steps) {
    if (cur === null || cur === undefined) return null;
    if (Array.isArray(cur) && /^-?\d+$/.test(st.key)) {
      const idx = Number(st.key);
      cur = cur[idx < 0 ? cur.length + idx : idx];
    } else if (cur && typeof cur === "object" && !Array.isArray(cur)) {
      cur = (cur as Record<string, unknown>)[st.key];
    } else return null;
    if (cur === undefined) return null;
    if (st.asText) cur = cur === null ? null : typeof cur === "string" ? cur : textForm(cur);
  }
  return cur;
}

function castOut(v: unknown, cast: string): unknown {
  if (v === null || v === undefined) return null;
  switch (cast) {
    case "text":
    case "varchar":
      return typeof v === "string" ? v : textForm(v);
    case "int":
    case "int4":
    case "int8":
    case "integer":
    case "bigint":
    case "smallint":
      return typeof v === "number" ? Math.round(v) : Number.parseInt(textForm(v), 10);
    case "numeric":
    case "float":
    case "float8":
    case "real":
    case "double":
      return Number(v);
    case "boolean":
    case "bool":
      return v === true || v === "true" || v === "t";
    case "json":
    case "jsonb":
      return typeof v === "string" ? (() => { try { return JSON.parse(v); } catch { return v; } })() : v;
    default:
      return v;
  }
}

/** Embedded values computed for one row, keyed by embed alias. */
export type EmbedValues = Map<string, unknown>;

/** Builds the output object of `row` for `node` (embedded values are supplied by the caller). */
export function projectRow(schema: Schema, node: PlanNode, row: Row, embedded: EmbedValues): Row {
  const t = schema.tables.get(node.table) as TableDef;
  const out: Row = {};
  for (const it of node.items) {
    if (it.k === "star") {
      for (const c of t.columns.keys()) out[c] = clone(row[c] ?? null);
    } else if (it.k === "col") {
      let v = it.json.length ? jsonPathValue(row[it.name], it.json) : row[it.name];
      if (it.cast) v = castOut(v, it.cast);
      out[it.alias] = clone(v ?? null);
    } else if (it.k === "count") {
      // count-only nodes are aggregated by the executor; never reached for normal rows
      out[it.alias] = null;
    } else if (it.k === "embed") {
      const v = embedded.get(it.alias);
      if (it.spread) {
        if (v && typeof v === "object" && !Array.isArray(v)) Object.assign(out, v);
        else if (v === null || v === undefined) {
          // spread of a missing to-one: its columns become null
          const sub = node.embeds.find((e) => e.item === it);
          if (sub) for (const k of outputKeys(schema, sub)) out[k] = null;
        } else out[it.alias] = v;
      } else out[it.alias] = v === undefined ? null : v;
    }
  }
  return out;
}

/** Output keys of a node (for null spreads). */
function outputKeys(schema: Schema, node: PlanNode): string[] {
  const t = schema.tables.get(node.table) as TableDef;
  const keys: string[] = [];
  for (const it of node.items) {
    if (it.k === "star") keys.push(...t.columns.keys());
    else if (it.k === "col" || it.k === "count") keys.push(it.alias);
    else if (it.k === "embed") keys.push(it.alias);
  }
  return keys;
}
