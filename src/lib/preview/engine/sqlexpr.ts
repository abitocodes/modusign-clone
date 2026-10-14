/**
 * SQL tokenizer + a small expression evaluator (subset of Postgres) used by the preview engine for
 * CHECK constraints and partial unique-index predicates. Anything beyond the subset throws
 * `SqlUnsupported` at compile time, so callers can fall back to "not enforced".
 */
import { deepEqual, isPlainObject, nowIso, uuid } from "./util";

export interface Tok {
  /** id = bare identifier/keyword (lower-cased), qid = "quoted identifier", str = string literal, num, op, p = punctuation */
  t: "id" | "qid" | "str" | "num" | "op" | "p";
  v: string;
  pos: number;
}

export class SqlUnsupported extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SqlUnsupported";
  }
}

const OP_CHARS = "+-*/<>=~!@#%^&|`?";

/** Tokenizes SQL text. Comments are dropped; dollar-quoted bodies become a single `str` token. */
export function tokenize(sql: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    // whitespace
    if (c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f") {
      i++;
      continue;
    }
    // comments
    if (c === "-" && sql[i + 1] === "-") {
      while (i < n && sql[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && sql[i + 1] === "*") {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (sql[i] === "/" && sql[i + 1] === "*") {
          depth++;
          i += 2;
        } else if (sql[i] === "*" && sql[i + 1] === "/") {
          depth--;
          i += 2;
        } else i++;
      }
      continue;
    }
    const start = i;
    // E'…' escape strings
    if ((c === "e" || c === "E") && sql[i + 1] === "'") {
      i += 2;
      let v = "";
      while (i < n) {
        const d = sql[i];
        if (d === "\\" && i + 1 < n) {
          const e = sql[i + 1];
          v += e === "n" ? "\n" : e === "t" ? "\t" : e === "r" ? "\r" : e;
          i += 2;
        } else if (d === "'" && sql[i + 1] === "'") {
          v += "'";
          i += 2;
        } else if (d === "'") {
          i++;
          break;
        } else {
          v += d;
          i++;
        }
      }
      out.push({ t: "str", v, pos: start });
      continue;
    }
    // '…' strings
    if (c === "'") {
      i++;
      let v = "";
      while (i < n) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          v += "'";
          i += 2;
        } else if (sql[i] === "'") {
          i++;
          break;
        } else v += sql[i++];
      }
      out.push({ t: "str", v, pos: start });
      continue;
    }
    // $tag$ … $tag$ dollar quoting
    if (c === "$") {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i, i + 64));
      if (m) {
        const tag = m[0];
        const bodyStart = i + tag.length;
        const end = sql.indexOf(tag, bodyStart);
        const stop = end < 0 ? n : end;
        out.push({ t: "str", v: sql.slice(bodyStart, stop), pos: start });
        i = end < 0 ? n : end + tag.length;
        continue;
      }
      // positional parameter $1
      let j = i + 1;
      while (j < n && /[0-9]/.test(sql[j])) j++;
      out.push({ t: "id", v: sql.slice(i, j), pos: start });
      i = j;
      continue;
    }
    // "quoted identifiers"
    if (c === '"') {
      i++;
      let v = "";
      while (i < n) {
        if (sql[i] === '"' && sql[i + 1] === '"') {
          v += '"';
          i += 2;
        } else if (sql[i] === '"') {
          i++;
          break;
        } else v += sql[i++];
      }
      out.push({ t: "qid", v, pos: start });
      continue;
    }
    // numbers
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(sql[i + 1] ?? ""))) {
      let j = i;
      while (j < n && /[0-9]/.test(sql[j])) j++;
      if (sql[j] === "." && /[0-9]/.test(sql[j + 1] ?? "")) {
        j++;
        while (j < n && /[0-9]/.test(sql[j])) j++;
      } else if (sql[j] === "." && !/[A-Za-z_.]/.test(sql[j + 1] ?? "")) {
        j++;
      }
      if ((sql[j] === "e" || sql[j] === "E") && /[-+0-9]/.test(sql[j + 1] ?? "")) {
        j++;
        if (sql[j] === "+" || sql[j] === "-") j++;
        while (j < n && /[0-9]/.test(sql[j])) j++;
      }
      out.push({ t: "num", v: sql.slice(i, j), pos: start });
      i = j;
      continue;
    }
    // identifiers / keywords
    if (/[A-Za-z_\u0080-￿]/.test(c)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_$\u0080-￿]/.test(sql[j])) j++;
      out.push({ t: "id", v: sql.slice(i, j).toLowerCase(), pos: start });
      i = j;
      continue;
    }
    // punctuation
    if (c === ":" && sql[i + 1] === ":") {
      out.push({ t: "p", v: "::", pos: start });
      i += 2;
      continue;
    }
    if ("(),;.[]:".includes(c)) {
      out.push({ t: "p", v: c, pos: start });
      i++;
      continue;
    }
    // operators
    if (OP_CHARS.includes(c)) {
      let j = i;
      while (j < n && OP_CHARS.includes(sql[j])) {
        if ((sql[j] === "-" && sql[j + 1] === "-") || (sql[j] === "/" && sql[j + 1] === "*")) break;
        j++;
      }
      let op = sql.slice(i, j);
      // Postgres rule: a multi-char operator cannot end in + or - unless it contains one of ~!@#%^&|`?
      while (op.length > 1 && /[+-]$/.test(op) && !/[~!@#%^&|`?]/.test(op)) op = op.slice(0, -1);
      out.push({ t: "op", v: op, pos: start });
      i += op.length;
      continue;
    }
    // anything else: skip (never seen in migrations)
    i++;
  }
  return out;
}

/** Splits a token stream into statements on top-level `;`. */
export function splitStatements(toks: Tok[]): Tok[][] {
  const out: Tok[][] = [];
  let cur: Tok[] = [];
  for (const t of toks) {
    if (t.t === "p" && t.v === ";") {
      if (cur.length) out.push(cur);
      cur = [];
    } else cur.push(t);
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Re-joins tokens into readable SQL (for messages / debugging). */
export function tokensToSql(toks: Tok[]): string {
  let s = "";
  let prev: Tok | null = null;
  for (const t of toks) {
    const text = t.t === "str" ? `'${t.v.replace(/'/g, "''")}'` : t.t === "qid" ? `"${t.v}"` : t.v;
    const glue =
      !prev ||
      (prev.t === "p" && (prev.v === "(" || prev.v === "." || prev.v === "::" || prev.v === "[")) ||
      (t.t === "p" && (t.v === ")" || t.v === "," || t.v === "." || t.v === "::" || t.v === "]" || t.v === "[")) ||
      (t.t === "p" && t.v === "(" && prev.t === "id")
        ? ""
        : " ";
    s += glue + text;
    prev = t;
  }
  return s;
}

// ---------------------------------------------------------------------------------------------
// Expression AST
// ---------------------------------------------------------------------------------------------

export type Expr =
  | { k: "lit"; v: unknown }
  | { k: "col"; name: string }
  | { k: "fn"; name: string; args: Expr[] }
  | { k: "cast"; e: Expr; type: string }
  | { k: "not"; e: Expr }
  | { k: "neg"; e: Expr }
  | { k: "and"; l: Expr; r: Expr }
  | { k: "or"; l: Expr; r: Expr }
  | { k: "bin"; op: string; l: Expr; r: Expr }
  | { k: "isnull"; e: Expr; not: boolean }
  | { k: "isdistinct"; l: Expr; r: Expr; not: boolean }
  | { k: "isbool"; e: Expr; v: boolean; not: boolean }
  | { k: "between"; e: Expr; lo: Expr; hi: Expr; not: boolean }
  | { k: "in"; e: Expr; list: Expr[]; not: boolean }
  | { k: "like"; e: Expr; pat: Expr; ci: boolean; not: boolean }
  | { k: "array"; items: Expr[] };

const CMP_OPS = new Set(["=", "<>", "!=", "<", ">", "<=", ">="]);
const ADD_OPS = new Set(["+", "-"]);
const MUL_OPS = new Set(["*", "/", "%"]);

/** Reads a type name at `toks[i]` (`double precision`, `timestamp with time zone`, `text[]`, `varchar(20)` …). */
export function readTypeName(toks: Tok[], i: number): { type: string; next: number } {
  const words: string[] = [];
  let j = i;
  const tok = toks[j];
  if (!tok || (tok.t !== "id" && tok.t !== "qid")) throw new SqlUnsupported("type name expected");
  // optional schema qualification
  if (toks[j + 1]?.t === "p" && toks[j + 1].v === "." && (toks[j + 2]?.t === "id" || toks[j + 2]?.t === "qid")) {
    j += 2;
  }
  words.push(toks[j].v);
  j++;
  const first = words[0];
  const MULTI: Record<string, string[][]> = {
    double: [["precision"]],
    character: [["varying"]],
    bit: [["varying"]],
    timestamp: [["with", "time", "zone"], ["without", "time", "zone"]],
    time: [["with", "time", "zone"], ["without", "time", "zone"]],
  };
  for (const seq of MULTI[first] ?? []) {
    if (seq.every((w, k) => toks[j + k]?.t === "id" && toks[j + k].v === w)) {
      words.push(...seq);
      j += seq.length;
      break;
    }
  }
  // (n) / (p, s) modifiers
  if (toks[j]?.t === "p" && toks[j].v === "(") {
    let depth = 0;
    for (; j < toks.length; j++) {
      if (toks[j].t === "p" && toks[j].v === "(") depth++;
      else if (toks[j].t === "p" && toks[j].v === ")") {
        depth--;
        if (depth === 0) {
          j++;
          break;
        }
      }
    }
  }
  let array = false;
  while (toks[j]?.t === "p" && toks[j].v === "[" && toks[j + 1]?.t === "p" && toks[j + 1].v === "]") {
    array = true;
    j += 2;
  }
  return { type: normalizeType(words.join(" ")) + (array ? "[]" : ""), next: j };
}

/** Canonical type names (int4 → integer, timestamp with time zone → timestamptz, …). */
export function normalizeType(t: string): string {
  const s = t.trim().toLowerCase();
  const map: Record<string, string> = {
    int: "integer",
    int4: "integer",
    integer: "integer",
    int2: "smallint",
    smallint: "smallint",
    int8: "bigint",
    bigint: "bigint",
    serial: "integer",
    serial4: "integer",
    bigserial: "bigint",
    serial8: "bigint",
    smallserial: "smallint",
    float8: "double precision",
    "double precision": "double precision",
    float4: "real",
    real: "real",
    float: "double precision",
    decimal: "numeric",
    numeric: "numeric",
    bool: "boolean",
    boolean: "boolean",
    "timestamp with time zone": "timestamptz",
    timestamptz: "timestamptz",
    "timestamp without time zone": "timestamp",
    timestamp: "timestamp",
    "time with time zone": "timetz",
    "time without time zone": "time",
    varchar: "text",
    "character varying": "text",
    character: "text",
    char: "text",
    bpchar: "text",
    citext: "text",
    name: "text",
    text: "text",
  };
  return map[s] ?? s;
}

/** Parses an expression from tokens `toks[start, end)`. Throws SqlUnsupported. */
export function parseExpr(toks: Tok[], start = 0, end = toks.length): Expr {
  const p = new ExprParser(toks.slice(start, end));
  const e = p.parseOr();
  if (!p.done()) throw new SqlUnsupported(`unexpected token "${p.peek()?.v}"`);
  return e;
}

class ExprParser {
  toks: Tok[];
  i = 0;
  constructor(toks: Tok[]) {
    this.toks = toks;
  }
  done() {
    return this.i >= this.toks.length;
  }
  peek(o = 0): Tok | undefined {
    return this.toks[this.i + o];
  }
  isKw(v: string, o = 0) {
    const t = this.peek(o);
    return !!t && t.t === "id" && t.v === v;
  }
  isP(v: string, o = 0) {
    const t = this.peek(o);
    return !!t && t.t === "p" && t.v === v;
  }
  isOp(o = 0) {
    const t = this.peek(o);
    return !!t && t.t === "op";
  }
  expectP(v: string) {
    if (!this.isP(v)) throw new SqlUnsupported(`"${v}" expected`);
    this.i++;
  }
  expectKw(v: string) {
    if (!this.isKw(v)) throw new SqlUnsupported(`"${v}" expected`);
    this.i++;
  }

  parseOr(): Expr {
    let l = this.parseAnd();
    while (this.isKw("or")) {
      this.i++;
      l = { k: "or", l, r: this.parseAnd() };
    }
    return l;
  }
  parseAnd(): Expr {
    let l = this.parseNot();
    while (this.isKw("and")) {
      this.i++;
      l = { k: "and", l, r: this.parseNot() };
    }
    return l;
  }
  parseNot(): Expr {
    if (this.isKw("not")) {
      this.i++;
      return { k: "not", e: this.parseNot() };
    }
    return this.parseIs();
  }
  parseIs(): Expr {
    let e = this.parseCmp();
    for (;;) {
      if (this.isKw("isnull")) {
        this.i++;
        e = { k: "isnull", e, not: false };
        continue;
      }
      if (this.isKw("notnull")) {
        this.i++;
        e = { k: "isnull", e, not: true };
        continue;
      }
      if (!this.isKw("is")) break;
      this.i++;
      let not = false;
      if (this.isKw("not")) {
        not = true;
        this.i++;
      }
      if (this.isKw("null")) {
        this.i++;
        e = { k: "isnull", e, not };
      } else if (this.isKw("true") || this.isKw("false")) {
        const v = this.peek()!.v === "true";
        this.i++;
        e = { k: "isbool", e, v, not };
      } else if (this.isKw("distinct")) {
        this.i++;
        this.expectKw("from");
        e = { k: "isdistinct", l: e, r: this.parseCmp(), not };
      } else throw new SqlUnsupported("IS … not supported");
    }
    return e;
  }
  parseCmp(): Expr {
    const l = this.parseRange();
    const t = this.peek();
    if (t && t.t === "op" && CMP_OPS.has(t.v)) {
      this.i++;
      const r = this.parseRange();
      return { k: "bin", op: t.v === "!=" ? "<>" : t.v, l, r };
    }
    return l;
  }
  parseRange(): Expr {
    const e = this.parseOther();
    let not = false;
    if (this.isKw("not") && (this.isKw("between", 1) || this.isKw("in", 1) || this.isKw("like", 1) || this.isKw("ilike", 1))) {
      not = true;
      this.i++;
    }
    if (this.isKw("between")) {
      this.i++;
      if (this.isKw("symmetric")) throw new SqlUnsupported("between symmetric");
      const lo = this.parseOther();
      this.expectKw("and");
      const hi = this.parseOther();
      return { k: "between", e, lo, hi, not };
    }
    if (this.isKw("in")) {
      this.i++;
      this.expectP("(");
      if (this.isKw("select")) throw new SqlUnsupported("IN (subquery)");
      const list: Expr[] = [];
      if (!this.isP(")")) {
        list.push(this.parseOr());
        while (this.isP(",")) {
          this.i++;
          list.push(this.parseOr());
        }
      }
      this.expectP(")");
      return { k: "in", e, list, not };
    }
    if (this.isKw("like") || this.isKw("ilike")) {
      const ci = this.peek()!.v === "ilike";
      this.i++;
      const pat = this.parseOther();
      if (this.isKw("escape")) throw new SqlUnsupported("LIKE … ESCAPE");
      return { k: "like", e, pat, ci, not };
    }
    if (not) throw new SqlUnsupported("NOT …");
    return e;
  }
  parseOther(): Expr {
    let l = this.parseAdd();
    for (;;) {
      const t = this.peek();
      if (!t || t.t !== "op" || CMP_OPS.has(t.v) || ADD_OPS.has(t.v) || MUL_OPS.has(t.v)) break;
      this.i++;
      const r = this.parseAdd();
      if (t.v === "~~") l = { k: "like", e: l, pat: r, ci: false, not: false };
      else if (t.v === "~~*") l = { k: "like", e: l, pat: r, ci: true, not: false };
      else if (t.v === "!~~") l = { k: "like", e: l, pat: r, ci: false, not: true };
      else if (t.v === "!~~*") l = { k: "like", e: l, pat: r, ci: true, not: true };
      else l = { k: "bin", op: t.v, l, r };
    }
    return l;
  }
  parseAdd(): Expr {
    let l = this.parseMul();
    for (;;) {
      const t = this.peek();
      if (!t || t.t !== "op" || !ADD_OPS.has(t.v)) break;
      this.i++;
      l = { k: "bin", op: t.v, l, r: this.parseMul() };
    }
    return l;
  }
  parseMul(): Expr {
    let l = this.parseUnary();
    for (;;) {
      const t = this.peek();
      if (!t || t.t !== "op" || !MUL_OPS.has(t.v)) break;
      this.i++;
      l = { k: "bin", op: t.v, l, r: this.parseUnary() };
    }
    return l;
  }
  parseUnary(): Expr {
    const t = this.peek();
    if (t && t.t === "op" && (t.v === "-" || t.v === "+")) {
      this.i++;
      const e = this.parseUnary();
      return t.v === "-" ? { k: "neg", e } : e;
    }
    return this.parsePostfix();
  }
  parsePostfix(): Expr {
    let e = this.parsePrimary();
    for (;;) {
      if (this.isP("::")) {
        this.i++;
        const { type, next } = readTypeName(this.toks, this.i);
        this.i = next;
        e = { k: "cast", e, type };
        continue;
      }
      if (this.isP("[")) throw new SqlUnsupported("subscripts");
      break;
    }
    return e;
  }
  parsePrimary(): Expr {
    const t = this.peek();
    if (!t) throw new SqlUnsupported("unexpected end of expression");
    if (t.t === "num") {
      this.i++;
      return { k: "lit", v: Number(t.v) };
    }
    if (t.t === "str") {
      this.i++;
      return { k: "lit", v: t.v };
    }
    if (t.t === "p" && t.v === "(") {
      this.i++;
      if (this.isKw("select")) throw new SqlUnsupported("subquery");
      const e = this.parseOr();
      if (this.isP(",")) throw new SqlUnsupported("row constructor");
      this.expectP(")");
      return e;
    }
    if (t.t === "qid") {
      this.i++;
      return this.columnTail(t.v);
    }
    if (t.t === "id") {
      const v = t.v;
      if (v === "true" || v === "false") {
        this.i++;
        return { k: "lit", v: v === "true" };
      }
      if (v === "null") {
        this.i++;
        return { k: "lit", v: null };
      }
      if (v === "array" && this.isP("[", 1)) {
        this.i += 2;
        const items: Expr[] = [];
        if (!this.isP("]")) {
          items.push(this.parseOr());
          while (this.isP(",")) {
            this.i++;
            items.push(this.parseOr());
          }
        }
        this.expectP("]");
        return { k: "array", items };
      }
      if (v === "current_timestamp" || v === "localtimestamp" || v === "current_date") {
        this.i++;
        return { k: "fn", name: "now", args: [] };
      }
      if (v === "case" || v === "exists" || v === "select" || v === "any" || v === "all") {
        throw new SqlUnsupported(v);
      }
      // typed literal: interval '10 minutes', timestamptz '…'
      if (this.peek(1)?.t === "str" && ["interval", "timestamptz", "timestamp", "date", "uuid", "text", "jsonb", "json"].includes(v)) {
        const s = this.peek(1)!.v;
        this.i += 2;
        return { k: "cast", e: { k: "lit", v: s }, type: normalizeType(v) };
      }
      this.i++;
      // function call
      if (this.isP("(")) {
        this.i++;
        const args: Expr[] = [];
        if (this.isKw("distinct")) throw new SqlUnsupported("aggregate");
        if (!this.isP(")")) {
          args.push(this.parseOr());
          while (this.isP(",")) {
            this.i++;
            args.push(this.parseOr());
          }
        }
        this.expectP(")");
        return { k: "fn", name: v, args };
      }
      return this.columnTail(v);
    }
    throw new SqlUnsupported(`unexpected token "${t.v}"`);
  }
  /** `a.b.c` → column c (qualifiers such as new./old./table. are dropped); `schema.fn(...)` → fn */
  columnTail(first: string): Expr {
    let name = first;
    while (this.isP(".") && (this.peek(1)?.t === "id" || this.peek(1)?.t === "qid")) {
      name = this.peek(1)!.v;
      this.i += 2;
      if (this.isP("(")) {
        this.i++;
        const args: Expr[] = [];
        if (!this.isP(")")) {
          args.push(this.parseOr());
          while (this.isP(",")) {
            this.i++;
            args.push(this.parseOr());
          }
        }
        this.expectP(")");
        return { k: "fn", name, args };
      }
    }
    return { k: "col", name };
  }
}

// ---------------------------------------------------------------------------------------------
// Evaluation (three-valued logic: SQL NULL = JS null)
// ---------------------------------------------------------------------------------------------

export interface EvalEnv {
  /** column value; throw for unknown columns */
  col(name: string): unknown;
}

function truthy3(v: unknown): boolean | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    if (/^(t|true|yes|on|1)$/i.test(v)) return true;
    if (/^(f|false|no|off|0)$/i.test(v)) return false;
  }
  throw new SqlUnsupported("non-boolean condition");
}

function toText(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "bigint") return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  return JSON.stringify(v);
}

/** Compares two non-null scalar values (numbers numerically, everything else as text, code-point order). */
export function compareScalars(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a < b ? -1 : a > b ? 1 : 0;
  if (typeof a === "number" && typeof b === "string" && b.trim() !== "" && !Number.isNaN(Number(b))) return compareScalars(a, Number(b));
  if (typeof b === "number" && typeof a === "string" && a.trim() !== "" && !Number.isNaN(Number(a))) return compareScalars(Number(a), b);
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  const sa = toText(a);
  const sb = toText(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

/** SQL LIKE pattern → RegExp (backslash escapes; `%` any, `_` one char). */
export function likeToRegExp(pattern: string, ci: boolean): RegExp {
  let re = "^";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "\\" && i + 1 < pattern.length) {
      re += pattern[++i].replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
    } else if (c === "%") re += "[\\s\\S]*";
    else if (c === "_") re += "[\\s\\S]";
    else re += c.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  }
  return new RegExp(re + "$", ci ? "iu" : "u");
}

function btrim(s: string, chars = " "): string {
  let a = 0;
  let b = s.length;
  while (a < b && chars.includes(s[a])) a++;
  while (b > a && chars.includes(s[b - 1])) b--;
  return s.slice(a, b);
}

function jsonbTypeof(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return "array";
  if (typeof v === "object") return "object";
  if (typeof v === "string") return "string";
  if (typeof v === "number") return "number";
  if (typeof v === "boolean") return "boolean";
  return null;
}

/** A Postgres interval (months kept separately like Postgres does). */
export class PgInterval {
  months: number;
  ms: number;
  constructor(months: number, ms: number) {
    this.months = months;
    this.ms = ms;
  }
}

const INTERVAL_UNITS: Record<string, { months?: number; ms?: number }> = {
  microsecond: { ms: 0.001 },
  millisecond: { ms: 1 },
  second: { ms: 1000 },
  minute: { ms: 60_000 },
  hour: { ms: 3_600_000 },
  day: { ms: 86_400_000 },
  week: { ms: 7 * 86_400_000 },
  month: { months: 1 },
  year: { months: 12 },
};

export function parseInterval(text: string): PgInterval {
  const s = text.trim().toLowerCase();
  let months = 0;
  let ms = 0;
  const hms = /^(-)?(\d+):(\d{2})(?::(\d{2}(?:\.\d+)?))?$/.exec(s);
  if (hms) {
    const sign = hms[1] ? -1 : 1;
    ms = sign * ((Number(hms[2]) * 60 + Number(hms[3])) * 60_000 + Number(hms[4] ?? 0) * 1000);
    return new PgInterval(0, ms);
  }
  const re = /([-+]?\d+(?:\.\d+)?)\s*([a-z]+)/g;
  let m: RegExpExecArray | null;
  let any = false;
  while ((m = re.exec(s))) {
    let unit = m[2].replace(/s$/, "");
    if (unit === "min" || unit === "mins") unit = "minute";
    if (unit === "sec" || unit === "secs") unit = "second";
    if (unit === "hr" || unit === "hrs") unit = "hour";
    if (unit === "mon" || unit === "mons") unit = "month";
    if (unit === "yr" || unit === "yrs") unit = "year";
    if (unit === "msec" || unit === "ms") unit = "millisecond";
    const u = INTERVAL_UNITS[unit];
    if (!u) throw new SqlUnsupported(`interval unit ${m[2]}`);
    const n = Number(m[1]);
    months += (u.months ?? 0) * n;
    ms += (u.ms ?? 0) * n;
    any = true;
  }
  if (!any) throw new SqlUnsupported(`interval '${text}'`);
  return new PgInterval(months, ms);
}

function addInterval(ts: string, iv: PgInterval, sign: 1 | -1): string {
  if (ts === "infinity" || ts === "-infinity") return ts;
  const d = new Date(Date.parse(ts));
  if (Number.isNaN(d.getTime())) throw new SqlUnsupported("timestamp arithmetic on a non-timestamp");
  if (iv.months) d.setUTCMonth(d.getUTCMonth() + sign * iv.months);
  return new Date(d.getTime() + sign * iv.ms).toISOString();
}

function parseArrayLiteralLoose(s: string): (string | null)[] {
  const t = s.trim();
  if (!t.startsWith("{") || !t.endsWith("}")) throw new SqlUnsupported("malformed array literal");
  const body = t.slice(1, -1).trim();
  if (!body) return [];
  return body.split(",").map((x) => {
    const p = x.trim();
    if (/^null$/i.test(p)) return null;
    return p.startsWith('"') && p.endsWith('"') ? p.slice(1, -1).replace(/\\(.)/g, "$1") : p;
  });
}

function castValue(v: unknown, type: string): unknown {
  if (v === null || v === undefined) return null;
  const base = type.endsWith("[]") ? type.slice(0, -2) : type;
  if (type.endsWith("[]")) {
    if (Array.isArray(v)) return v.map((x) => castValue(x, base));
    if (typeof v === "string") return parseArrayLiteralLoose(v).map((x) => castValue(x, base));
    throw new SqlUnsupported("array cast");
  }
  if (base === "interval") return v instanceof PgInterval ? v : parseInterval(toText(v));
  switch (base) {
    case "text":
      return toText(v);
    case "uuid":
      return toText(v).toLowerCase();
    case "integer":
    case "smallint":
    case "bigint": {
      const n = typeof v === "number" ? v : Number(toText(v).trim());
      if (!Number.isFinite(n)) throw new SqlUnsupported("bad integer cast");
      return Math.round(n);
    }
    case "numeric":
    case "double precision":
    case "real": {
      const n = typeof v === "number" ? v : Number(toText(v).trim());
      if (Number.isNaN(n)) throw new SqlUnsupported("bad numeric cast");
      return n;
    }
    case "boolean":
      return truthy3(v);
    case "jsonb":
    case "json":
      return typeof v === "string" ? JSON.parse(v) : v;
    case "timestamptz":
    case "timestamp": {
      if (typeof v !== "string") return v;
      if (/^[-+]?infinity$/i.test(v.trim())) return v.trim().toLowerCase().replace("+", "");
      if (/^now$/i.test(v.trim())) return nowIso();
      const ms = Date.parse(v);
      return Number.isNaN(ms) ? v : new Date(ms).toISOString();
    }
    case "date":
    default:
      return v;
  }
}

/** Evaluates an expression; SQL NULL is `null`. Throws SqlUnsupported for unknown functions. */
export function evaluate(e: Expr, env: EvalEnv): unknown {
  switch (e.k) {
    case "lit":
      return e.v;
    case "col":
      return env.col(e.name) ?? null;
    case "cast":
      return castValue(evaluate(e.e, env), e.type);
    case "neg": {
      const v = evaluate(e.e, env);
      return v === null ? null : -Number(v);
    }
    case "not": {
      const v = truthy3(evaluate(e.e, env));
      return v === null ? null : !v;
    }
    case "and": {
      const l = truthy3(evaluate(e.l, env));
      if (l === false) return false;
      const r = truthy3(evaluate(e.r, env));
      if (r === false) return false;
      return l === null || r === null ? null : true;
    }
    case "or": {
      const l = truthy3(evaluate(e.l, env));
      if (l === true) return true;
      const r = truthy3(evaluate(e.r, env));
      if (r === true) return true;
      return l === null || r === null ? null : false;
    }
    case "isnull": {
      const v = evaluate(e.e, env);
      const isNull = v === null || v === undefined;
      return e.not ? !isNull : isNull;
    }
    case "isbool": {
      const v = truthy3(evaluate(e.e, env));
      const r = v === e.v;
      return e.not ? !r : r;
    }
    case "isdistinct": {
      const l = evaluate(e.l, env);
      const r = evaluate(e.r, env);
      let distinct: boolean;
      if (l === null || r === null) distinct = !(l === null && r === null);
      else distinct = !(typeof l === "object" || typeof r === "object" ? deepEqual(l, r) : compareScalars(l, r) === 0);
      return e.not ? !distinct : distinct;
    }
    case "between": {
      const v = evaluate(e.e, env);
      const lo = evaluate(e.lo, env);
      const hi = evaluate(e.hi, env);
      if (v === null || lo === null || hi === null) return null;
      const r = compareScalars(v, lo) >= 0 && compareScalars(v, hi) <= 0;
      return e.not ? !r : r;
    }
    case "in": {
      const v = evaluate(e.e, env);
      if (v === null) return null;
      let sawNull = false;
      for (const item of e.list) {
        const x = evaluate(item, env);
        if (x === null) {
          sawNull = true;
          continue;
        }
        if (compareScalars(v, x) === 0) return !e.not;
      }
      if (sawNull) return null;
      return e.not;
    }
    case "like": {
      const v = evaluate(e.e, env);
      const p = evaluate(e.pat, env);
      if (v === null || p === null) return null;
      const r = likeToRegExp(toText(p), e.ci).test(toText(v));
      return e.not ? !r : r;
    }
    case "array":
      return e.items.map((x) => evaluate(x, env));
    case "bin":
      return evalBinary(e.op, evaluate(e.l, env), evaluate(e.r, env));
    case "fn":
      return evalFn(
        e.name,
        e.args.map((a) => evaluate(a, env)),
      );
  }
}

function evalBinary(op: string, l: unknown, r: unknown): unknown {
  if (op === "||") {
    if (l === null || r === null) return null;
    if (Array.isArray(l) || Array.isArray(r)) return [...(Array.isArray(l) ? l : [l]), ...(Array.isArray(r) ? r : [r])];
    if (isPlainObject(l) && isPlainObject(r)) return { ...l, ...r };
    return toText(l) + toText(r);
  }
  if (l === null || r === null) return null;
  if ((op === "+" || op === "-") && (l instanceof PgInterval || r instanceof PgInterval)) {
    if (l instanceof PgInterval && r instanceof PgInterval) {
      const s = op === "+" ? 1 : -1;
      return new PgInterval(l.months + s * r.months, l.ms + s * r.ms);
    }
    if (r instanceof PgInterval && typeof l === "string") return addInterval(l, r, op === "+" ? 1 : -1);
    if (l instanceof PgInterval && typeof r === "string" && op === "+") return addInterval(r, l, 1);
    throw new SqlUnsupported("interval arithmetic");
  }
  if (op === "*" && (l instanceof PgInterval || r instanceof PgInterval)) {
    const iv = (l instanceof PgInterval ? l : r) as PgInterval;
    const n = Number(l instanceof PgInterval ? r : l);
    return new PgInterval(iv.months * n, iv.ms * n);
  }
  switch (op) {
    case "=":
      return typeof l === "object" || typeof r === "object" ? deepEqual(l, r) : compareScalars(l, r) === 0;
    case "<>":
      return typeof l === "object" || typeof r === "object" ? !deepEqual(l, r) : compareScalars(l, r) !== 0;
    case "<":
      return compareScalars(l, r) < 0;
    case ">":
      return compareScalars(l, r) > 0;
    case "<=":
      return compareScalars(l, r) <= 0;
    case ">=":
      return compareScalars(l, r) >= 0;
    case "+":
      return Number(l) + Number(r);
    case "-":
      return Number(l) - Number(r);
    case "*":
      return Number(l) * Number(r);
    case "/": {
      const d = Number(r);
      if (d === 0) throw new SqlUnsupported("division by zero");
      const q = Number(l) / d;
      return Number.isInteger(Number(l)) && Number.isInteger(d) ? Math.trunc(q) : q;
    }
    case "%":
      return Number(l) % Number(r);
    case "~":
      return new RegExp(toText(r), "u").test(toText(l));
    case "~*":
      return new RegExp(toText(r), "iu").test(toText(l));
    case "!~":
      return !new RegExp(toText(r), "u").test(toText(l));
    case "!~*":
      return !new RegExp(toText(r), "iu").test(toText(l));
    default:
      throw new SqlUnsupported(`operator ${op}`);
  }
}

function evalFn(name: string, args: unknown[]): unknown {
  const a0 = args[0];
  switch (name) {
    case "coalesce":
      return args.find((x) => x !== null && x !== undefined) ?? null;
    case "nullif":
      if (a0 === null) return null;
      return args[1] !== null && compareScalars(a0, args[1]) === 0 ? null : a0;
    case "greatest":
    case "least": {
      const xs = args.filter((x) => x !== null);
      if (!xs.length) return null;
      return xs.reduce((m, x) => ((name === "greatest" ? compareScalars(x, m) > 0 : compareScalars(x, m) < 0) ? x : m));
    }
    case "now":
    case "transaction_timestamp":
    case "statement_timestamp":
    case "clock_timestamp":
      return nowIso();
    case "concat":
      return args.filter((x) => x !== null).map(toText).join("");
    case "gen_random_uuid":
    case "uuid_generate_v4":
      return uuid();
    case "timezone":
      // timezone('utc', now()) → the timestamp itself (all timestamps are UTC ISO strings here)
      return args[1] ?? null;
  }
  if (a0 === null || a0 === undefined) return null;
  switch (name) {
    case "btrim":
    case "trim":
      return btrim(toText(a0), args[1] === undefined || args[1] === null ? " " : toText(args[1]));
    case "ltrim": {
      const chars = args[1] == null ? " " : toText(args[1]);
      const s = toText(a0);
      let i = 0;
      while (i < s.length && chars.includes(s[i])) i++;
      return s.slice(i);
    }
    case "rtrim": {
      const chars = args[1] == null ? " " : toText(args[1]);
      const s = toText(a0);
      let i = s.length;
      while (i > 0 && chars.includes(s[i - 1])) i--;
      return s.slice(0, i);
    }
    case "lower":
      return toText(a0).toLowerCase();
    case "upper":
      return toText(a0).toUpperCase();
    case "char_length":
    case "character_length":
    case "length":
      return [...toText(a0)].length;
    case "octet_length":
      return new TextEncoder().encode(toText(a0)).length;
    case "left": {
      const n = Number(args[1]);
      const cps = [...toText(a0)];
      return (n >= 0 ? cps.slice(0, n) : cps.slice(0, Math.max(0, cps.length + n))).join("");
    }
    case "right": {
      const n = Number(args[1]);
      const cps = [...toText(a0)];
      return (n >= 0 ? cps.slice(Math.max(0, cps.length - n)) : cps.slice(-n)).join("");
    }
    case "jsonb_typeof":
    case "json_typeof":
      return jsonbTypeof(a0);
    case "jsonb_array_length":
    case "json_array_length":
      if (!Array.isArray(a0)) throw new SqlUnsupported("jsonb_array_length of a non-array");
      return a0.length;
    case "cardinality":
      return Array.isArray(a0) ? a0.length : null;
    case "array_length":
      return Array.isArray(a0) && a0.length > 0 ? a0.length : null;
    case "abs":
      return Math.abs(Number(a0));
  }
  throw new SqlUnsupported(`function ${name}()`);
}

/** Compiles a boolean SQL expression into a row predicate (true / false / null). */
export function compilePredicate(toks: Tok[]): (row: Record<string, unknown>) => boolean | null {
  const expr = parseExpr(toks);
  return (row) => {
    const v = evaluate(expr, {
      col(name) {
        if (!Object.prototype.hasOwnProperty.call(row, name)) throw new SqlUnsupported(`column ${name}`);
        return row[name];
      },
    });
    return truthy3(v);
  };
}
