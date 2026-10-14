/**
 * PostgREST horizontal filtering for the preview engine.
 *
 * Filters arrive in wire form — exactly what supabase-js puts in the URL — e.g. key "status",
 * value "eq.in_progress"; key "documents.workspace_id", value "eq.<uuid>"; key "or", value
 * "(a.eq.1,and(b.gt.2,c.is.null))"; key "participants.or" for a referenced table.
 * Values are typed through the column definition (uuid / enum / timestamptz / boolean / arrays …),
 * comparisons follow SQL three-valued logic (a NULL operand makes the condition unknown → row dropped,
 * and NOT unknown is still unknown).
 *
 * Operators: eq neq gt gte lt lte like ilike match imatch is isdistinct in cs cd ov
 * (+ `(any)` / `(all)` modifiers, naive fts/plfts/phfts/wfts). Range operators → PGRST100 error.
 */
import type { ColumnDef, Row, Schema, TableDef } from "../types";
import { PgException } from "./errors";
import { jsonPathValue } from "./select";
import type { JsonStep } from "./select";
import { likeToRegExp } from "./sqlexpr";
import { jsonContains, parsePgArrayLiteral, splitTopLevel, unquote } from "./util";
import { coerceFilterText, compareTyped, equalTyped, textForm } from "./values";

export type FilterNode =
  | {
      k: "cond";
      /** embed alias path ([] = the queried table itself) */
      path: string[];
      column: string;
      json: JsonStep[];
      negate: boolean;
      op: string;
      modifier: "any" | "all" | null;
      value: string;
      /** value came from a logic tree / in-list (double quotes already significant) */
      inTree: boolean;
    }
  | { k: "logic"; path: string[]; op: "and" | "or"; negate: boolean; children: FilterNode[] };

const OPERATORS = new Set([
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "like",
  "ilike",
  "match",
  "imatch",
  "is",
  "isdistinct",
  "in",
  "cs",
  "cd",
  "ov",
  "fts",
  "plfts",
  "phfts",
  "wfts",
  "sl",
  "sr",
  "nxl",
  "nxr",
  "adj",
]);

function badFilter(msg: string): PgException {
  return new PgException(msg, "PGRST100", null, null);
}

/** Splits a column key `a.b.col->x->>y` into path / column / json steps. */
export function parseColumnKey(key: string): { path: string[]; column: string; json: JsonStep[] } {
  const arrow = key.indexOf("->");
  const head = arrow >= 0 ? key.slice(0, arrow) : key;
  const jsonPart = arrow >= 0 ? key.slice(arrow) : "";
  const segs = head.split(".");
  const column = unquote(segs.pop() as string);
  const json: JsonStep[] = [];
  const re = /(->>|->)('([^']*)'|"([^"]*)"|[^-]+(?:-(?!>)[^-]*)*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(jsonPart))) json.push({ key: m[3] ?? m[4] ?? m[2], asText: m[1] === "->>" });
  return { path: segs.map(unquote), column, json };
}

/** Parses `[not.]op[(any|all)][(config)].value`. */
function parseOpValue(s: string): { negate: boolean; op: string; modifier: "any" | "all" | null; value: string } {
  let rest = s;
  let negate = false;
  if (rest.startsWith("not.")) {
    negate = true;
    rest = rest.slice(4);
  }
  const dot = rest.indexOf(".");
  const opPart = dot < 0 ? rest : rest.slice(0, dot);
  const value = dot < 0 ? "" : rest.slice(dot + 1);
  const m = /^([a-z]+)(?:\((any|all)\))?(?:\(([^)]*)\))?$/.exec(opPart);
  if (!m || !OPERATORS.has(m[1])) throw badFilter(`"failed to parse filter (${s})" (line 1, column 1)`);
  return { negate, op: m[1], modifier: (m[2] as "any" | "all" | undefined) ?? null, value };
}

/** A single wire filter (`key=value`) → node. */
export function parseFilterParam(key: string, value: string): FilterNode {
  // logic trees: or / and / not.or / not.and, optionally prefixed by an embed path
  const lm = /^(?:(.*)\.)?(not\.)?(or|and)$/.exec(key);
  if (lm && value.startsWith("(")) {
    const path = lm[1] ? lm[1].split(".") : [];
    return parseLogic(lm[3] as "and" | "or", !!lm[2], value, path);
  }
  const { path, column, json } = parseColumnKey(key);
  const ov = parseOpValue(value);
  return { k: "cond", path, column, json, ...ov, inTree: false };
}

/** `(a.eq.1,and(b.gt.2,c.is.null))` */
export function parseLogic(op: "and" | "or", negate: boolean, value: string, path: string[]): FilterNode {
  const v = value.trim();
  if (!v.startsWith("(") || !v.endsWith(")")) throw badFilter(`"failed to parse logic tree (${value})" (line 1, column 1)`);
  const children: FilterNode[] = [];
  for (const rawPart of splitTopLevel(v.slice(1, -1))) {
    const part = rawPart.trim();
    if (!part) continue;
    const nested = /^(not\.)?(and|or)\(([\s\S]*)\)$/.exec(part);
    if (nested) {
      children.push(parseLogic(nested[2] as "and" | "or", !!nested[1], `(${nested[3]})`, path));
      continue;
    }
    // column.[not.]op.value — the column is everything before the first "." that is not inside a JSON arrow
    const dot = part.indexOf(".");
    if (dot <= 0) throw badFilter(`"failed to parse logic tree (${value})" (line 1, column 2)`);
    const colKey = part.slice(0, dot);
    const { column, json } = parseColumnKey(colKey);
    const ov = parseOpValue(part.slice(dot + 1));
    children.push({ k: "cond", path, column, json, ...ov, inTree: true });
  }
  return { k: "logic", path, op, negate, children };
}

// ---------------------------------------------------------------------------------------------
// compilation
// ---------------------------------------------------------------------------------------------

/** Row predicate in three-valued logic. */
export type Pred = (row: Row) => boolean | null;

export interface CompileContext {
  schema: Schema;
  table: TableDef;
  /** filter on an embed alias itself (`rel=is.null` / `rel=not.is.null`): the caller supplies the embedded value */
  embedValue?: (row: Row, alias: string) => unknown;
  /** aliases of embeds at this level */
  embedAliases?: Set<string>;
}

function not3(v: boolean | null): boolean | null {
  return v === null ? null : !v;
}

/** Postgres `is` values. */
function isValue(text: string): "null" | "not_null" | true | false | "unknown" {
  const t = text.trim().toLowerCase();
  if (t === "null") return "null";
  if (t === "not_null") return "not_null";
  if (t === "true") return true;
  if (t === "false") return false;
  if (t === "unknown") return "unknown";
  throw badFilter(`"failed to parse filter (is.${text})" (line 1, column 4)`);
}

function likePattern(v: string): string {
  // PostgREST accepts * as an alias of %
  return v.replace(/\*/g, "%");
}

function listValues(text: string): string[] {
  const t = text.trim();
  if (!t.startsWith("(") || !t.endsWith(")")) throw badFilter(`"failed to parse filter (in.${text})" (line 1, column 4)`);
  const body = t.slice(1, -1);
  if (body.trim() === "") return [];
  return splitTopLevel(body).map((x) => unquote(x.trim()));
}

/** column definition used to type the filter value (json paths change the type) */
function effectiveColumn(col: ColumnDef, json: JsonStep[]): ColumnDef {
  if (!json.length) return col;
  const asText = json[json.length - 1].asText;
  return { name: col.name, type: asText ? "text" : "jsonb", baseType: asText ? "text" : "jsonb", isArray: false, nullable: true };
}

function compileCond(n: Extract<FilterNode, { k: "cond" }>, ctx: CompileContext): Pred {
  const { schema, table } = ctx;
  const rawCol = table.columns.get(n.column);
  if (!rawCol) {
    // `rel=is.null` / `rel=not.is.null` on an embedded resource
    if (ctx.embedAliases?.has(n.column) && n.op === "is" && !n.json.length && ctx.embedValue) {
      const want = isValue(n.value);
      if (want !== "null" && want !== "not_null") throw badFilter(`only is.null / not.is.null are supported on embedded resources`);
      const getter = ctx.embedValue;
      return (row) => {
        const v = getter(row, n.column);
        const empty = v === null || v === undefined || (Array.isArray(v) && v.length === 0);
        const r = want === "null" ? empty : !empty;
        return n.negate ? !r : r;
      };
    }
    throw new PgException(`column ${table.name}.${n.column} does not exist`, "42703");
  }
  const col = effectiveColumn(rawCol, n.json);
  const get = (row: Row) => {
    const v = n.json.length ? jsonPathValue(row[n.column], n.json) : row[n.column];
    return v === undefined ? null : v;
  };
  const value = n.value;
  // inside or()/and() trees PostgREST strips "double quotes" from values; a top-level value is taken verbatim
  const typed = (text: string) => coerceFilterText(col, n.inTree ? unquote(text) : text, schema);
  let base: Pred;

  const cmp = (op: string, rhs: unknown): Pred => {
    switch (op) {
      case "eq":
        return (row) => {
          const v = get(row);
          return v === null || rhs === null ? null : equalTyped(col, v, rhs, schema);
        };
      case "neq":
        return (row) => {
          const v = get(row);
          return v === null || rhs === null ? null : !equalTyped(col, v, rhs, schema);
        };
      case "gt":
      case "gte":
      case "lt":
      case "lte":
        return (row) => {
          const v = get(row);
          if (v === null || rhs === null) return null;
          const c = compareTyped(col, v, rhs, schema);
          return op === "gt" ? c > 0 : op === "gte" ? c >= 0 : op === "lt" ? c < 0 : c <= 0;
        };
      default:
        throw badFilter(`operator ${op}`);
    }
  };

  const likeFn = (pattern: string, ci: boolean): Pred => {
    const re = likeToRegExp(likePattern(pattern), ci);
    return (row) => {
      const v = get(row);
      return v === null ? null : re.test(textForm(v));
    };
  };

  const regexFn = (pattern: string, ci: boolean): Pred => {
    let re: RegExp;
    try {
      re = new RegExp(pattern, ci ? "iu" : "u");
    } catch {
      throw new PgException(`invalid regular expression: ${pattern}`, "2201B");
    }
    return (row) => {
      const v = get(row);
      return v === null ? null : re.test(textForm(v));
    };
  };

  const single = (op: string, text: string): Pred => {
    switch (op) {
      case "eq":
      case "neq":
      case "gt":
      case "gte":
      case "lt":
      case "lte":
        return cmp(op, typed(text));
      case "like":
        return likeFn(n.inTree ? unquote(text) : text, false);
      case "ilike":
        return likeFn(n.inTree ? unquote(text) : text, true);
      case "match":
        return regexFn(n.inTree ? unquote(text) : text, false);
      case "imatch":
        return regexFn(n.inTree ? unquote(text) : text, true);
      default:
        throw badFilter(`operator ${op} does not take (any)/(all)`);
    }
  };

  switch (n.op) {
    case "eq":
    case "neq":
    case "gt":
    case "gte":
    case "lt":
    case "lte":
    case "like":
    case "ilike":
    case "match":
    case "imatch": {
      if (n.modifier) {
        const items = parsePgArrayLiteral(value);
        if (!items) throw badFilter(`"failed to parse filter (${n.op}(${n.modifier}).${value})"`);
        const preds = items.map((x) => single(n.op, x ?? "null"));
        const any = n.modifier === "any";
        base = (row) => {
          let sawNull = false;
          for (const p of preds) {
            const r = p(row);
            if (r === null) sawNull = true;
            else if (any && r) return true;
            else if (!any && !r) return false;
          }
          if (sawNull) return null;
          return !any;
        };
      } else base = single(n.op, value);
      break;
    }
    case "is": {
      const want = isValue(value);
      base = (row) => {
        const v = get(row);
        if (want === "null") return v === null;
        if (want === "not_null") return v !== null;
        if (want === "unknown") return v === null;
        return v === want;
      };
      break;
    }
    case "isdistinct": {
      const rhs = /^null$/i.test(value) ? null : typed(value);
      base = (row) => {
        const v = get(row);
        if (v === null || rhs === null) return !(v === null && rhs === null);
        return !equalTyped(col, v, rhs, schema);
      };
      break;
    }
    case "in": {
      // list items are unquoted by listValues (both at the top level and inside logic trees)
      const typedItems = listValues(value).map((x) => coerceFilterText(col, x, schema));
      base = (row) => {
        const v = get(row);
        if (v === null) return null;
        let sawNull = false;
        for (const it of typedItems) {
          if (it === null) {
            sawNull = true;
            continue;
          }
          if (equalTyped(col, v, it, schema)) return true;
        }
        return sawNull ? null : false;
      };
      break;
    }
    case "cs":
    case "cd":
    case "ov": {
      const text = n.inTree ? unquote(value) : value;
      if (col.isArray) {
        const arr = coerceFilterText(col, text, schema) as unknown[];
        base = (row) => {
          const v = get(row);
          if (v === null) return null;
          const have = v as unknown[];
          const inArr = (x: unknown, list: unknown[]) => list.some((y) => (x === null || y === null ? false : equalTyped({ ...col, isArray: false, type: col.baseType }, x, y, schema)));
          if (n.op === "cs") return arr.every((x) => inArr(x, have));
          if (n.op === "cd") return have.every((x) => inArr(x, arr));
          return arr.some((x) => inArr(x, have));
        };
      } else if (col.baseType === "jsonb" || col.baseType === "json") {
        if (n.op === "ov") throw badFilter("ov is not defined for jsonb");
        let want: unknown;
        try {
          want = JSON.parse(text);
        } catch {
          throw new PgException("invalid input syntax for type json", "22P02", `Token "${text}" is invalid.`);
        }
        base = (row) => {
          const v = get(row);
          if (v === null) return null;
          return n.op === "cs" ? jsonContains(v, want) : jsonContains(want, v);
        };
      } else {
        throw badFilter(`operator ${n.op} on ${table.name}.${n.column} (${col.type}) is not supported in preview`);
      }
      break;
    }
    case "fts":
    case "plfts":
    case "phfts":
    case "wfts": {
      // naive: every word of the query occurs in the text (case-insensitive)
      const words = (n.inTree ? unquote(value) : value)
        .toLowerCase()
        .replace(/[&|!()':<>*]/g, " ")
        .split(/\s+/)
        .filter(Boolean);
      const phrase = n.op === "phfts";
      base = (row) => {
        const v = get(row);
        if (v === null) return null;
        const hay = textForm(v).toLowerCase();
        return phrase ? hay.includes(words.join(" ")) : words.every((w) => hay.includes(w));
      };
      break;
    }
    default:
      throw badFilter(`operator ${n.op} (range types) is not supported in preview`);
  }
  return n.negate ? (row) => not3(base(row)) : base;
}

/** Compiles a filter node against `ctx.table`. */
export function compileFilter(n: FilterNode, ctx: CompileContext): Pred {
  if (n.k === "cond") return compileCond(n, ctx);
  const children = n.children.map((c) => compileFilter(c, ctx));
  const isAnd = n.op === "and";
  const pred: Pred = (row) => {
    let sawNull = false;
    for (const c of children) {
      const r = c(row);
      if (r === null) sawNull = true;
      else if (isAnd && !r) return false;
      else if (!isAnd && r) return true;
    }
    if (sawNull) return null;
    return isAnd;
  };
  return n.negate ? (row) => not3(pred(row)) : pred;
}

/** AND of several predicates (three-valued). */
export function andAll(preds: Pred[]): Pred {
  return (row) => {
    let sawNull = false;
    for (const p of preds) {
      const r = p(row);
      if (r === false) return false;
      if (r === null) sawNull = true;
    }
    return sawNull ? null : true;
  };
}
