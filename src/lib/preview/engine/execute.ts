/**
 * executeDataOp: runs a recorded supabase-js call chain against the preview database with
 * PostgREST semantics.
 *
 * The chain is first turned into the request supabase-js would send (method, URL params in wire
 * form, Prefer header, body) — so value formatting (`eq.${value}`, `in.(…)` quoting, `cs.{…}`,
 * `or=(…)`, order/limit/offset keys, `columns` for bulk inserts) is identical — and then
 * interpreted the way PostgREST does: embeds, filters on embedded resources (`rel.col`, `!inner`),
 * per-resource order/limit/offset, count, single/maybeSingle, upsert on_conflict / resolution,
 * return=representation only when `.select()` is chained, safe-update (21000) and statement atomicity.
 * Results are deep copies; callers can never mutate the store through them.
 */
import { RPCS } from "../rpc";
import type { ChainCall, ColumnDef, DataOp, PgError, PgResult, PreviewDb, PreviewSession, Row, RpcContext, RpcImpl, Schema, TableDef } from "../types";
import { Db, asEngineDb, getPreviewDb } from "./db";
import { PgException, errorResult, okResult, statusText, toPgError } from "./errors";
import { andAll, compileFilter, parseColumnKey, parseFilterParam } from "./filters";
import type { FilterNode, Pred } from "./filters";
import { createRecorder } from "./recorder";
import { buildPlan, cleanSelect, jsonPathValue, parseSelect, projectRow } from "./select";
import type { EmbedPlan, EmbedValues, JsonStep, PlanNode } from "./select";
import { clone, isPlainObject, jsonRoundTrip, nowIso, uuid } from "./util";
import { compareTyped, textForm } from "./values";

export interface ExecuteOptions {
  /** database to run against (default: the shared preview db) */
  db?: PreviewDb;
  /** RPC registry (default: RPCS from ../rpc) */
  rpcs?: Record<string, RpcImpl>;
}

type Method = "GET" | "HEAD" | "POST" | "PATCH" | "DELETE";

interface WireRequest {
  method: Method | null;
  upsert: boolean;
  /** URL search params in order (filters are appended; select/order/limit/offset/on_conflict/columns are set) */
  params: [string, string][];
  prefer: {
    return?: "representation";
    count?: string;
    resolution?: "merge" | "ignore";
    missingDefault?: boolean;
    rollback?: boolean;
    maxAffected?: number;
  };
  body: unknown;
  accept: "array" | "object" | "csv";
  maybeSingle: boolean;
  stripNulls: boolean;
}

const RESERVED_KEYS = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"]);
const NOOP_METHODS = new Set(["throwOnError", "returns", "overrideTypes", "abortSignal", "setHeader", "retry", "schema"]);

function warnGap(msg: string) {
  console.warn(`[preview] ${msg}`);
}

function s(v: unknown): string {
  return `${v as string}`;
}

function setParam(params: [string, string][], key: string, value: string) {
  const at = params.findIndex(([k]) => k === key);
  if (at >= 0) params[at] = [key, value];
  else params.push([key, value]);
}

function getParam(params: [string, string][], key: string): string | undefined {
  return params.find(([k]) => k === key)?.[1];
}

function badRequest(message: string, code = "PGRST100"): PgException {
  return new PgException(message, code);
}

function optObj(v: unknown): Record<string, unknown> {
  return isPlainObject(v) ? v : {};
}

function refTable(o: Record<string, unknown>): string | undefined {
  const r = (o.referencedTable ?? o.foreignTable) as string | undefined;
  return typeof r === "string" && r ? r : undefined;
}

/** Turns the recorded chain into the request supabase-js would send. */
export function chainToRequest(chain: ChainCall[], isRpc: boolean): WireRequest {
  const req: WireRequest = { method: isRpc ? "POST" : null, upsert: false, params: [], prefer: {}, body: undefined, accept: "array", maybeSingle: false, stripNulls: false };
  const filter = (key: string, value: string) => req.params.push([key, value]);
  for (const call of chain) {
    if (!call || typeof call.m !== "string" || !Array.isArray(call.a)) throw badRequest("malformed call chain", "PGRST100");
    const a = call.a;
    const m = call.m;
    if (!req.method && !["select", "insert", "upsert", "update", "delete"].includes(m) && !NOOP_METHODS.has(m)) {
      throw badRequest(`.${m}() called before select/insert/upsert/update/delete`);
    }
    switch (m) {
      case "select": {
        const columns = a[0] as string | undefined;
        if (!req.method) {
          const o = optObj(a[1]);
          req.method = o.head ? "HEAD" : "GET";
          if (o.count) req.prefer.count = s(o.count);
        } else {
          req.prefer.return = "representation";
        }
        setParam(req.params, "select", cleanSelect(columns ?? "*"));
        break;
      }
      case "insert":
      case "upsert": {
        req.method = "POST";
        const values = a[0];
        const o = optObj(a[1]);
        req.body = values;
        if (o.count) req.prefer.count = s(o.count);
        if (o.defaultToNull === false) req.prefer.missingDefault = true;
        if (m === "upsert") {
          req.upsert = true;
          req.prefer.resolution = o.ignoreDuplicates ? "ignore" : "merge";
          if (o.onConflict !== undefined) setParam(req.params, "on_conflict", s(o.onConflict));
        }
        if (Array.isArray(values)) {
          const cols = [...new Set(values.flatMap((x) => (isPlainObject(x) ? Object.keys(x) : [])))];
          if (cols.length) setParam(req.params, "columns", cols.map((c) => `"${c}"`).join(","));
        }
        break;
      }
      case "update": {
        req.method = "PATCH";
        req.body = a[0];
        const o = optObj(a[1]);
        if (o.count) req.prefer.count = s(o.count);
        break;
      }
      case "delete": {
        req.method = "DELETE";
        const o = optObj(a[0]);
        if (o.count) req.prefer.count = s(o.count);
        break;
      }
      // --- filters (same formatting as postgrest-js) ---
      case "eq":
      case "neq":
      case "gt":
      case "gte":
      case "lt":
      case "lte":
      case "like":
      case "ilike":
      case "is":
        filter(s(a[0]), `${m}.${s(a[1])}`);
        break;
      case "isDistinct":
        filter(s(a[0]), `isdistinct.${s(a[1])}`);
        break;
      case "regexMatch":
        filter(s(a[0]), `match.${s(a[1])}`);
        break;
      case "regexIMatch":
        filter(s(a[0]), `imatch.${s(a[1])}`);
        break;
      case "likeAllOf":
      case "likeAnyOf":
      case "ilikeAllOf":
      case "ilikeAnyOf": {
        const op = m.startsWith("ilike") ? "ilike" : "like";
        const mod = m.endsWith("AllOf") ? "all" : "any";
        filter(s(a[0]), `${op}(${mod}).{${(a[1] as unknown[]).join(",")}}`);
        break;
      }
      case "in":
      case "notIn": {
        const values = Array.isArray(a[1]) ? a[1] : [];
        const cleaned = Array.from(new Set(values))
          .map((x) => (typeof x === "string" && /[,()]/.test(x) ? `"${x}"` : s(x)))
          .join(",");
        filter(s(a[0]), `${m === "notIn" ? "not.in" : "in"}.(${cleaned})`);
        break;
      }
      case "contains":
      case "containedBy": {
        const op = m === "contains" ? "cs" : "cd";
        const v = a[1];
        if (typeof v === "string") filter(s(a[0]), `${op}.${v}`);
        else if (Array.isArray(v)) filter(s(a[0]), `${op}.{${v.join(",")}}`);
        else filter(s(a[0]), `${op}.${JSON.stringify(v)}`);
        break;
      }
      case "overlaps": {
        const v = a[1];
        if (typeof v === "string") filter(s(a[0]), `ov.${v}`);
        else filter(s(a[0]), `ov.{${(v as unknown[]).join(",")}}`);
        break;
      }
      case "rangeGt":
        filter(s(a[0]), `sr.${s(a[1])}`);
        break;
      case "rangeGte":
        filter(s(a[0]), `nxl.${s(a[1])}`);
        break;
      case "rangeLt":
        filter(s(a[0]), `sl.${s(a[1])}`);
        break;
      case "rangeLte":
        filter(s(a[0]), `nxr.${s(a[1])}`);
        break;
      case "rangeAdjacent":
        filter(s(a[0]), `adj.${s(a[1])}`);
        break;
      case "textSearch": {
        const o = optObj(a[2]);
        const typePart = o.type === "plain" ? "pl" : o.type === "phrase" ? "ph" : o.type === "websearch" ? "w" : "";
        const configPart = o.config === undefined ? "" : `(${s(o.config)})`;
        filter(s(a[0]), `${typePart}fts${configPart}.${s(a[1])}`);
        break;
      }
      case "match":
        for (const [k, v] of Object.entries(optObj(a[0]))) if (v !== undefined) filter(k, `eq.${s(v)}`);
        break;
      case "not":
        filter(s(a[0]), `not.${s(a[1])}.${s(a[2])}`);
        break;
      case "or": {
        const rt = refTable(optObj(a[1]));
        filter(rt ? `${rt}.or` : "or", `(${s(a[0])})`);
        break;
      }
      case "filter":
        filter(s(a[0]), `${s(a[1])}.${s(a[2])}`);
        break;
      // --- transforms ---
      case "order": {
        const o = optObj(a[1]);
        const rt = refTable(o);
        const key = rt ? `${rt}.order` : "order";
        const ascending = o.ascending === undefined ? true : !!o.ascending;
        const nulls = o.nullsFirst === undefined ? "" : o.nullsFirst ? ".nullsfirst" : ".nullslast";
        const existing = getParam(req.params, key);
        setParam(req.params, key, `${existing ? `${existing},` : ""}${s(a[0])}.${ascending ? "asc" : "desc"}${nulls}`);
        break;
      }
      case "limit": {
        const rt = refTable(optObj(a[1]));
        setParam(req.params, rt ? `${rt}.limit` : "limit", s(a[0]));
        break;
      }
      case "range": {
        const rt = refTable(optObj(a[2]));
        const from = Number(a[0]);
        const to = Number(a[1]);
        setParam(req.params, rt ? `${rt}.offset` : "offset", s(from));
        setParam(req.params, rt ? `${rt}.limit` : "limit", s(to - from + 1));
        break;
      }
      case "single":
        req.accept = "object";
        break;
      case "maybeSingle":
        req.maybeSingle = true;
        break;
      case "csv":
        req.accept = "csv";
        break;
      case "stripNulls":
        req.stripNulls = true;
        break;
      case "rollback":
        req.prefer.rollback = true;
        break;
      case "maxAffected":
        req.prefer.maxAffected = Number(a[0]);
        break;
      case "geojson":
      case "explain":
        throw badRequest(`.${m}() is not supported in preview mode`);
      default:
        if (NOOP_METHODS.has(m)) break;
        throw badRequest(`unknown query builder method .${m}()`);
    }
  }
  return req;
}

// ---------------------------------------------------------------------------------------------
// read pipeline
// ---------------------------------------------------------------------------------------------

interface OrderTerm {
  column: string;
  json: JsonStep[];
  /** order by a column of an embedded to-one resource: `rel(col)` */
  embed?: string;
  desc: boolean;
  nullsFirst: boolean;
}

interface NodeRuntime {
  node: PlanNode;
  table: TableDef;
  filters: FilterNode[];
  orders: OrderTerm[];
  limit?: number;
  offset?: number;
  children: Map<string, NodeRuntime>;
  embedPlan?: EmbedPlan;
  pred?: Pred;
}

function parseOrder(value: string): OrderTerm[] {
  const terms: OrderTerm[] = [];
  for (const raw of value.split(",")) {
    const t = raw.trim();
    if (!t) continue;
    let rest = t;
    let embed: string | undefined;
    const em = /^([^(]+)\(([^)]+)\)(.*)$/.exec(t);
    if (em) {
      embed = em[1];
      rest = em[2] + em[3];
    }
    const parts = rest.split(".");
    let nullsFirst: boolean | null = null;
    let desc = false;
    while (parts.length > 1) {
      const last = parts[parts.length - 1];
      if (last === "asc" || last === "desc") {
        desc = last === "desc";
        parts.pop();
      } else if (last === "nullsfirst" || last === "nullslast") {
        nullsFirst = last === "nullsfirst";
        parts.pop();
      } else break;
    }
    const { column, json } = parseColumnKey(parts.join("."));
    terms.push({ column, json, embed, desc, nullsFirst: nullsFirst ?? desc });
  }
  return terms;
}

function buildRuntime(schema: Schema, node: PlanNode, embedPlan?: EmbedPlan): NodeRuntime {
  const rt: NodeRuntime = {
    node,
    table: schema.tables.get(node.table) as TableDef,
    filters: [],
    orders: [],
    children: new Map(),
    embedPlan,
  };
  for (const e of node.embeds) rt.children.set(e.item.alias, buildRuntime(schema, e, e));
  return rt;
}

function findRuntime(root: NodeRuntime, path: string[]): NodeRuntime {
  let cur = root;
  for (const seg of path) {
    let next = cur.children.get(seg);
    if (!next) {
      // PostgREST also accepts the relation name when it is not aliased
      for (const c of cur.children.values()) if (c.embedPlan?.item.rel === seg) next = c;
    }
    if (!next) {
      throw new PgException(`'${seg}' is not an embedded resource in this request`, "PGRST108", null, `Verify that '${seg}' is included in the 'select' query parameter.`);
    }
    cur = next;
  }
  return cur;
}

function intParam(v: string, key: string): number {
  if (!/^\d+$/.test(v.trim())) throw badRequest(`"failed to parse ${key} parameter (${v})"`, "PGRST100");
  return Number(v);
}

/** Distributes the wire params onto the plan tree. */
function attachParams(schema: Schema, root: NodeRuntime, params: [string, string][], allowRootFilters = true): void {
  for (const [key, value] of params) {
    if (RESERVED_KEYS.has(key)) {
      if (key === "order") root.orders.push(...parseOrder(value));
      else if (key === "limit") root.limit = intParam(value, "limit");
      else if (key === "offset") root.offset = intParam(value, "offset");
      continue;
    }
    const em = /^(.*)\.(order|limit|offset)$/.exec(key);
    if (em) {
      const rt = findRuntime(root, em[1].split("."));
      if (em[2] === "order") rt.orders.push(...parseOrder(value));
      else if (em[2] === "limit") rt.limit = intParam(value, key);
      else rt.offset = intParam(value, key);
      continue;
    }
    const node = parseFilterParam(key, value);
    const rt = findRuntime(root, node.path);
    if (!allowRootFilters && rt === root) continue;
    rt.filters.push(node);
  }
  compileRuntime(schema, root);
}

function compileRuntime(schema: Schema, rt: NodeRuntime) {
  const aliases = new Set(rt.children.keys());
  const preds = rt.filters.map((f) =>
    compileFilter(f, {
      schema,
      table: rt.table,
      embedAliases: aliases,
      embedValue: (row, alias) => (row as Row & { [EMBEDS]?: EmbedValues })[EMBEDS]?.get(alias),
    }),
  );
  rt.pred = preds.length ? andAll(preds) : undefined;
  for (const c of rt.children.values()) compileRuntime(schema, c);
}

const EMBEDS = Symbol("embeds");
const RAW_ONE = Symbol("rawOne");

type Annotated = Row & { [EMBEDS]?: EmbedValues; [RAW_ONE]?: Map<string, Row | null> };

interface EvalResult {
  rows: Annotated[];
  total: number;
}

function sortRows(schema: Schema, rt: NodeRuntime, rows: Annotated[]) {
  if (!rt.orders.length) return;
  const terms = rt.orders.map((o) => {
    let table = rt.table;
    if (o.embed) {
      const child = findRuntime(rt, [o.embed]);
      if (child.embedPlan && child.embedPlan.rel.kind === "o2m") throw badRequest(`cannot order by a to-many embedded resource (${o.embed})`);
      table = child.table;
    }
    const col = table.columns.get(o.column);
    if (!col) throw new PgException(`column ${table.name}.${o.column} does not exist`, "42703");
    const typed: ColumnDef | null = o.json.length ? null : col;
    return { o, col: typed };
  });
  const val = (row: Annotated, o: OrderTerm): unknown => {
    const src = o.embed ? (row[RAW_ONE]?.get(o.embed) ?? null) : row;
    if (!src) return null;
    const v = o.json.length ? jsonPathValue(src[o.column], o.json) : src[o.column];
    return v === undefined ? null : v;
  };
  rows.sort((a, b) => {
    for (const { o, col } of terms) {
      const va = val(a, o);
      const vb = val(b, o);
      if (va === null && vb === null) continue;
      if (va === null) return o.nullsFirst ? -1 : 1;
      if (vb === null) return o.nullsFirst ? 1 : -1;
      let c = compareTyped(col, va, vb, schema);
      if (o.desc) c = -c;
      if (c !== 0) return c;
    }
    return 0;
  });
}

/** per-query cache of embed indexes ("table.column" → value → rows); the db does not change during one read */
type IndexCache = Map<string, Map<unknown, Row[]>>;

/** Index of rows of `table` by `column` value (for embeds). */
function indexBy(rows: Row[], column: string): Map<unknown, Row[]> {
  const m = new Map<unknown, Row[]>();
  for (const r of rows) {
    const v = r[column];
    if (v === null || v === undefined) continue;
    const list = m.get(v);
    if (list) list.push(r);
    else m.set(v, [r]);
  }
  return m;
}

/**
 * Evaluates a plan node over candidate rows: embeds, (inner) filters, order, offset/limit.
 * `applyFilters=false` for mutation results (root filters were the WHERE clause already).
 */
function evalNode(db: Db, rt: NodeRuntime, candidates: Row[], applyFilters = true, cache: IndexCache = new Map()): EvalResult {
  const schema = db.schema;
  const rows: Annotated[] = candidates.map((r) => ({ ...r }));
  // embeds
  for (const [alias, child] of rt.children) {
    const ep = child.embedPlan as EmbedPlan;
    const rel = ep.rel;
    const cacheKey = `${rel.target}.${rel.targetColumn}`;
    let index = cache.get(cacheKey);
    if (!index) {
      index = indexBy(db.rows(rel.target), rel.targetColumn);
      cache.set(cacheKey, index);
    }
    const toMany = rel.kind === "o2m";
    for (const row of rows) {
      const key = row[rel.parentColumn];
      const related = key === null || key === undefined ? [] : (index.get(key) ?? []);
      const sub = evalNode(db, child, related, true, cache);
      let value: unknown;
      if (child.node.countOnly) {
        const count = sub.total;
        value = toMany ? [{ count }] : { count };
      } else {
        const projected = sub.rows.map((r) => projectRow(schema, child.node, r, r[EMBEDS] ?? new Map()));
        value = toMany ? projected : (projected[0] ?? null);
      }
      if (!row[EMBEDS]) row[EMBEDS] = new Map();
      row[EMBEDS].set(alias, value);
      if (!toMany) {
        if (!row[RAW_ONE]) row[RAW_ONE] = new Map();
        row[RAW_ONE].set(alias, sub.rows[0] ?? null);
      }
      // !inner: parents without a (filter-matching) embedded row are dropped
      if (ep.item.inner && sub.total === 0) (row as Annotated & { __drop?: boolean }).__drop = true;
    }
  }
  let out = rows.filter((r) => !(r as Annotated & { __drop?: boolean }).__drop);
  if (applyFilters && rt.pred) {
    const pred = rt.pred;
    out = out.filter((r) => pred(r) === true);
  }
  sortRows(schema, rt, out);
  const total = out.length;
  const offset = rt.offset ?? 0;
  if (offset || rt.limit !== undefined) out = out.slice(offset, rt.limit !== undefined ? offset + rt.limit : undefined);
  return { rows: out, total };
}

function stripNulls(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripNulls);
  if (isPlainObject(v)) {
    const o: Row = {};
    for (const [k, x] of Object.entries(v)) if (x !== null) o[k] = stripNulls(x);
    return o;
  }
  return v;
}

function toCsv(rows: Row[]): string {
  if (!rows.length) return "";
  const keys = Object.keys(rows[0]);
  const cell = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const t = typeof v === "string" ? v : textForm(v);
    return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  return [keys.join(","), ...rows.map((r) => keys.map((k) => cell(r[k])).join(","))].join("\n");
}

/** Applies Accept (single / maybeSingle / csv) and stripNulls to the projected rows. */
function shapeResult(req: WireRequest, rows: Row[], count: number | null, okStatus: number): PgResult {
  let data: unknown = rows;
  if (req.accept === "object") {
    if (rows.length !== 1) {
      return errorResult({
        message: "JSON object requested, multiple (or no) rows returned",
        code: "PGRST116",
        details: `The result contains ${rows.length} rows`,
        hint: null,
      });
    }
    data = rows[0];
  } else if (req.maybeSingle) {
    if (rows.length > 1) {
      return errorResult({
        message: "JSON object requested, multiple (or no) rows returned",
        code: "PGRST116",
        details: `Results contain ${rows.length} rows, application/vnd.pgrst.object+json requires 1 row`,
        hint: null,
      });
    }
    data = rows[0] ?? null;
  } else if (req.accept === "csv") {
    data = toCsv(rows);
  }
  if (req.stripNulls) data = stripNulls(data);
  return okResult(data, okStatus, count);
}

function wantsCount(req: WireRequest) {
  return !!req.prefer.count;
}

function runSelect(db: Db, table: string, req: WireRequest): PgResult {
  const schema = db.schema;
  db.tableDef(table);
  const plan = buildPlan(schema, table, parseSelect(getParam(req.params, "select") ?? "*"));
  const rt = buildRuntime(schema, plan);
  attachParams(schema, rt, req.params);
  const res = evalNode(db, rt, db.rows(table));
  const count = wantsCount(req) ? res.total : null;
  if (req.method === "HEAD") return okResult(null, 200, count);
  let rows: Row[];
  if (plan.countOnly) rows = [{ [(plan.items[0] as { alias: string }).alias]: res.total }];
  else rows = res.rows.map((r) => projectRow(schema, plan, r, r[EMBEDS] ?? new Map()));
  const partial = count !== null && rows.length < count;
  return shapeResult(req, rows, count, partial ? 206 : 200);
}

function rootPredicate(db: Db, table: string, req: WireRequest): { pred: Pred | null; rt: NodeRuntime } {
  const schema = db.schema;
  const plan = buildPlan(schema, table, parseSelect(getParam(req.params, "select") ?? "*"));
  const rt = buildRuntime(schema, plan);
  attachParams(schema, rt, req.params);
  return { pred: rt.pred ?? null, rt };
}

/** RETURNING representation of mutated rows (embeds + embed filters; root filters not re-applied). */
function represent(db: Db, rt: NodeRuntime, rows: Row[]): Row[] {
  const saved = { orders: rt.orders, limit: rt.limit, offset: rt.offset };
  rt.orders = [];
  rt.limit = undefined;
  rt.offset = undefined;
  try {
    const res = evalNode(db, rt, rows, false);
    return res.rows.map((r) => projectRow(db.schema, rt.node, r, r[EMBEDS] ?? new Map()));
  } finally {
    rt.orders = saved.orders;
    rt.limit = saved.limit;
    rt.offset = saved.offset;
  }
}

class Rollback extends Error {
  result: PgResult;
  constructor(result: PgResult) {
    super("rollback");
    this.result = result;
  }
}

function runMutation(db: Db, table: string, req: WireRequest): PgResult {
  const t = db.tableDef(table);
  const schema = db.schema;
  const returning = req.prefer.return === "representation";
  const exec = (tx: Db): PgResult => {
    let affected: Row[] = [];
    let rt: NodeRuntime;
    if (req.method === "POST") {
      const plan = buildPlan(schema, table, parseSelect(getParam(req.params, "select") ?? "*"));
      rt = buildRuntime(schema, plan);
      attachParams(schema, rt, req.params, false);
      const body = jsonRoundTrip(req.body);
      let rows: Row[];
      if (Array.isArray(body)) {
        if (!body.every(isPlainObject)) throw badRequest("All object keys must match", "PGRST102");
        rows = body as Row[];
        const colsParam = getParam(req.params, "columns");
        if (colsParam && !req.prefer.missingDefault) {
          const cols = colsParam.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
          rows = rows.map((r) => {
            const full: Row = {};
            for (const c of cols) full[c] = Object.prototype.hasOwnProperty.call(r, c) ? r[c] : null;
            return full;
          });
        }
      } else if (isPlainObject(body)) rows = [body];
      else throw badRequest("Empty or invalid json", "PGRST102");
      if (req.upsert) {
        const oc = getParam(req.params, "on_conflict");
        const target = oc ? oc.split(",").map((c) => c.trim().replace(/^"|"$/g, "")).filter(Boolean) : t.primaryKey;
        for (const c of target) if (!t.columns.has(c)) throw new PgException(`column "${c}" does not exist`, "42703");
        affected = tx.upsertRows(table, rows, { onConflict: target, ignoreDuplicates: req.prefer.resolution === "ignore" });
      } else {
        affected = tx.insertRows(table, rows);
      }
    } else {
      const { pred, rt: r } = rootPredicate(tx, table, req);
      rt = r;
      // Supabase runs PostgREST with pg-safeupdate: UPDATE / DELETE need a filter on the table itself
      if (!rt.filters.length) {
        throw new PgException(`${req.method === "PATCH" ? "UPDATE" : "DELETE"} requires a WHERE clause`, "21000");
      }
      let targets = tx.rows(table).filter((row) => (pred ? pred(row) === true : true));
      // order + limit on PATCH/DELETE (PostgREST applies them to the affected rows)
      if (rt.orders.length || rt.limit !== undefined || rt.offset !== undefined) {
        const tmp = targets.map((x) => ({ ...x }) as Annotated);
        const originals = new Map(tmp.map((x, i) => [x, targets[i]]));
        sortRows(schema, rt, tmp);
        const off = rt.offset ?? 0;
        const sliced = tmp.slice(off, rt.limit !== undefined ? off + rt.limit : undefined);
        targets = sliced.map((x) => originals.get(x) as Row);
      }
      const set = new Set(targets);
      if (req.method === "PATCH") {
        const body = jsonRoundTrip(req.body);
        if (!isPlainObject(body)) throw badRequest("Empty or invalid json", "PGRST102");
        affected = Object.keys(body).length ? tx.update(table, (row) => set.has(row), body) : targets;
      } else {
        affected = tx.remove(table, (row) => set.has(row));
      }
    }
    if (req.prefer.maxAffected !== undefined && affected.length > req.prefer.maxAffected) {
      throw new PgException("Query result exceeds max-affected preference constraint", "PGRST124", `The query affects ${affected.length} rows`);
    }
    const count = wantsCount(req) ? affected.length : null;
    const status = req.method === "POST" ? 201 : returning ? 200 : 204;
    if (!returning) return okResult(null, status, count);
    const rows = represent(tx, rt, affected);
    return shapeResult(req, rows, count, status);
  };
  return db.transaction((tx) => {
    const result = exec(tx as Db);
    if (req.prefer.rollback || result.error) throw new Rollback(result);
    return result;
  });
}

// ---------------------------------------------------------------------------------------------
// RPC
// ---------------------------------------------------------------------------------------------

/** Pseudo table describing an RPC's set-returning result (types inferred from the values). */
function pseudoTable(rows: Row[]): TableDef {
  const columns = new Map<string, ColumnDef>();
  for (const r of rows) {
    for (const [k, v] of Object.entries(r)) {
      if (columns.has(k) && v === null) continue;
      const type =
        typeof v === "number"
          ? "double precision"
          : typeof v === "boolean"
            ? "boolean"
            : Array.isArray(v) || isPlainObject(v)
              ? "jsonb"
              : typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)
                ? "timestamptz"
                : "text";
      columns.set(k, { name: k, type, baseType: type, isArray: false, nullable: true });
    }
  }
  return { name: "rpc_result", columns, primaryKey: [], uniques: [], uniqueKeys: [], foreignKeys: [], checks: [] };
}

function shapeRpcRows(schema: Schema, req: WireRequest, rows: Row[], options: DataOp & { kind: "rpc" }): PgResult {
  const pseudo = pseudoTable(rows);
  const pschema: Schema = { tables: new Map([...schema.tables, ["rpc_result", pseudo]]), enums: schema.enums };
  const selectParam = getParam(req.params, "select");
  const items = parseSelect(selectParam ?? "*");
  for (const it of items) {
    if (it.k === "embed") throw badRequest("embedding is not supported on RPC results in preview");
    if (it.k === "col" && !pseudo.columns.has(it.name)) pseudo.columns.set(it.name, { name: it.name, type: "text", baseType: "text", isArray: false, nullable: true });
  }
  const plan = buildPlan(pschema, "rpc_result", items);
  const rt = buildRuntime(pschema, plan);
  for (const [k, v] of req.params) {
    if (RESERVED_KEYS.has(k)) {
      if (k === "order") rt.orders.push(...parseOrder(v));
      else if (k === "limit") rt.limit = intParam(v, "limit");
      else if (k === "offset") rt.offset = intParam(v, "offset");
      continue;
    }
    const node = parseFilterParam(k, v);
    if (node.k === "cond" && !pseudo.columns.has(node.column)) pseudo.columns.set(node.column, { name: node.column, type: "text", baseType: "text", isArray: false, nullable: true });
    rt.filters.push(node);
  }
  compileRuntime(pschema, rt);
  let out = rows.filter((r) => (rt.pred ? rt.pred(r) === true : true)) as Annotated[];
  sortRows(pschema, rt, out);
  const total = out.length;
  const off = rt.offset ?? 0;
  if (off || rt.limit !== undefined) out = out.slice(off, rt.limit !== undefined ? off + rt.limit : undefined);
  const count = options.options?.count || req.prefer.count ? total : null;
  if (options.options?.head) return okResult(null, 200, count);
  const projected = out.map((r) => projectRow(pschema, plan, r, new Map()));
  return shapeResult(req, projected, count, 200);
}

async function runRpc(db: Db, op: DataOp & { kind: "rpc" }, session: PreviewSession, rpcs: Record<string, RpcImpl>): Promise<PgResult> {
  const impl = Object.prototype.hasOwnProperty.call(rpcs, op.fn) ? rpcs[op.fn] : undefined;
  const args = isPlainObject(op.args) ? (jsonRoundTrip(op.args) as Record<string, unknown>) : {};
  if (!impl) {
    const sig = Object.keys(args).join(", ");
    warnGap(`unknown RPC ${op.fn}(${sig}) — add it to src/lib/preview/rpc`);
    return errorResult({
      message: `Could not find the function public.${op.fn}(${sig}) in the schema cache`,
      code: "PGRST202",
      details: `Searched for the function public.${op.fn} with parameters ${sig || "(none)"} or with a single unnamed json/jsonb parameter, but no matches were found in the schema cache.`,
      hint: null,
    });
  }
  const req = chainToRequest(op.chain ?? [], true);
  let outcome: { data: unknown; error: PgError | null };
  try {
    outcome = await db.transaction(async (txAny) => {
      const tx = txAny as Db;
      const recorder = createRecorder((inner) => executeOn(tx, inner, session, rpcs));
      const ctx: RpcContext = {
        session,
        from: (table) => recorder.from(table),
        rpc: (fn, a = {}) => recorder.rpc(fn, a),
        db: tx,
        now: nowIso,
        uuid,
      };
      const r = await impl(ctx, args);
      const res = r && typeof r === "object" ? r : { data: r as unknown, error: null };
      if (res.error) throw new RpcFailed(res.error);
      return { data: res.data, error: null };
    });
  } catch (e) {
    const error = e instanceof RpcFailed ? e.error : toPgError(e, `rpc ${op.fn}`);
    return errorResult(error);
  }
  const data = outcome.data;
  if (data === undefined) {
    return { data: null, error: null, count: null, status: 204, statusText: statusText(204), success: true };
  }
  // set-returning results with chained select/filters/order/limit are treated like a table;
  // without any of them the value is returned verbatim (a `returns jsonb` array keeps its shape)
  if (Array.isArray(data) && req.params.length && data.every((x) => isPlainObject(x))) {
    return shapeRpcRows(db.schema, req, clone(data as Row[]), op);
  }
  const count = op.options?.count ? (Array.isArray(data) ? data.length : 1) : null;
  if (op.options?.head) return okResult(null, 200, count);
  if (Array.isArray(data)) return shapeResult(req, clone(data) as Row[], count, 200);
  return okResult(clone(data), 200, count);
}

class RpcFailed extends Error {
  error: PgError;
  constructor(error: PgError) {
    super(error.message);
    this.error = error;
  }
}

// ---------------------------------------------------------------------------------------------
// entry points
// ---------------------------------------------------------------------------------------------

const LOUD_CODES = new Set(["42P01", "42703", "PGRST100", "PGRST108", "PGRST200", "PGRST201", "PGRST204", "42P10", "XX000"]);

function validateOp(op: unknown): asserts op is DataOp {
  if (!isPlainObject(op)) throw badRequest("malformed request");
  if (op.kind === "from") {
    if (typeof op.table !== "string" || !op.table) throw badRequest("malformed request: table");
  } else if (op.kind === "rpc") {
    if (typeof op.fn !== "string" || !op.fn) throw badRequest("malformed request: fn");
  } else throw badRequest("malformed request: kind");
  if (op.chain !== undefined && !Array.isArray(op.chain)) throw badRequest("malformed request: chain");
}

/** Runs `op` on a specific db view (used for nested calls from RPCs: same transaction). */
export async function executeOn(db: PreviewDb, op: DataOp, session: PreviewSession, rpcs: Record<string, RpcImpl> = RPCS): Promise<PgResult> {
  let result: PgResult;
  try {
    validateOp(op);
    const engineDb = asEngineDb(db);
    if (!engineDb) throw new Error("executeOn: not a preview engine Db");
    const view = engineDb.withSession(session);
    if (op.kind === "rpc") return await runRpc(view, op, session, rpcs);
    const req = chainToRequest(op.chain ?? [], false);
    if (!req.method) throw badRequest("no select/insert/upsert/update/delete in the call chain");
    if (req.method === "GET" || req.method === "HEAD") result = runSelect(view, op.table, req);
    else result = runMutation(view, op.table, req);
  } catch (e) {
    if (e instanceof Rollback) result = e.result;
    else result = errorResult(toPgError(e, "executeDataOp"));
  }
  if (result.error && LOUD_CODES.has(result.error.code)) {
    const where = op && isPlainObject(op) ? (op.kind === "rpc" ? `rpc ${String(op.fn)}` : `from(${String(op.table)})`) : "";
    warnGap(`${where}: ${result.error.code} ${result.error.message}`);
  }
  return result;
}

/**
 * Executes a serialised supabase-js call (from the server recorder or the browser route) against
 * the preview database. Never rejects: failures come back as `{ error }` like supabase-js.
 * (`throwOnError()` is honoured by the recorder, which throws on an error result.)
 */
export async function executeDataOp(op: DataOp, session: PreviewSession, opts: ExecuteOptions = {}): Promise<PgResult> {
  let db: Db | null;
  try {
    db = asEngineDb(opts.db ?? getPreviewDb());
    if (!db) throw new Error("executeDataOp: opts.db must be a preview engine Db");
  } catch (e) {
    return errorResult(toPgError(e, "executeDataOp: database"));
  }
  return executeOn(db, op, session, opts.rpcs ?? RPCS);
}
