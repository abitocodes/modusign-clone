/**
 * Postgres-like value handling for the preview engine: write coercion (what a value becomes when
 * PostgREST stores it), parsing of filter literals (always text, like on the wire) and typed ordering.
 *
 * Canonical in-memory forms: uuid → lower-case string · integer/bigint/numeric/float → number ·
 * boolean → boolean · timestamptz → ISO string (toISOString) or 'infinity' / '-infinity' ·
 * date → 'YYYY-MM-DD' · jsonb → JSON value · arrays → JS arrays · enums / text → string.
 */
import type { ColumnDef, Schema } from "../types";
import { PgException } from "./errors";
import { UUID_RE, clone, deepEqual, parsePgArrayLiteral } from "./util";

export const INT_TYPES = new Set(["integer", "smallint", "bigint"]);
export const FLOAT_TYPES = new Set(["numeric", "double precision", "real"]);
export const TIME_TYPES = new Set(["timestamptz", "timestamp"]);

const TYPE_LABEL: Record<string, string> = {
  timestamptz: "timestamp with time zone",
  timestamp: "timestamp without time zone",
};

function typeLabel(t: string) {
  return TYPE_LABEL[t] ?? t;
}

function textOf(v: unknown): string {
  if (typeof v === "string") return v;
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function invalid(type: string, v: unknown, enumType = false): never {
  if (enumType) throw new PgException(`invalid input value for enum ${type}: "${textOf(v)}"`, "22P02");
  if (TIME_TYPES.has(type) || type === "date") {
    throw new PgException(`invalid input syntax for type ${typeLabel(type)}: "${textOf(v)}"`, "22007");
  }
  throw new PgException(`invalid input syntax for type ${typeLabel(type)}: "${textOf(v)}"`, "22P02");
}

const BOOL_TRUE = /^(t|tr|tru|true|y|ye|yes|on|1)$/i;
const BOOL_FALSE = /^(f|fa|fal|fals|false|n|no|off|0)$/i;

function toTimestamp(v: unknown, type: string): string {
  if (typeof v === "string") {
    const s = v.trim();
    if (/^(infinity|\+infinity)$/i.test(s)) return "infinity";
    if (/^-infinity$/i.test(s)) return "-infinity";
    if (/^now$/i.test(s)) return new Date().toISOString();
    // Postgres accepts "YYYY-MM-DD HH:MM:SS+09" etc.; Date.parse handles most ISO-ish inputs
    let ms = Date.parse(s);
    if (Number.isNaN(ms)) ms = Date.parse(s.replace(" ", "T"));
    if (Number.isNaN(ms) && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2}(\.\d+)?)?[+-]\d{2}$/.test(s)) ms = Date.parse(s.replace(" ", "T") + ":00");
    if (Number.isNaN(ms)) invalid(type, v);
    return new Date(ms).toISOString();
  }
  if (typeof v === "number" && Number.isFinite(v)) return new Date(v).toISOString();
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString();
  return invalid(type, v);
}

/** Coerces one scalar (non-array) value to the column's base type. `fromText` = filter literal semantics. */
function coerceScalar(baseType: string, v: unknown, schema: Schema, fromText: boolean): unknown {
  if (v === null || v === undefined) return null;
  const enumValues = schema.enums.get(baseType);
  if (enumValues) {
    if (typeof v !== "string" || !enumValues.includes(v)) invalid(baseType, v, true);
    return v;
  }
  switch (baseType) {
    case "uuid": {
      if (typeof v !== "string") invalid(baseType, v);
      let s = v.trim();
      if (/^\{.*\}$/.test(s)) s = s.slice(1, -1);
      if (/^[0-9a-f]{32}$/i.test(s)) s = `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
      if (!UUID_RE.test(s)) invalid(baseType, v);
      return s.toLowerCase();
    }
    case "integer":
    case "smallint":
    case "bigint": {
      if (typeof v === "number") {
        if (!Number.isInteger(v)) invalid(baseType, v);
        return v;
      }
      if (typeof v === "string" && /^\s*[-+]?\d+\s*$/.test(v)) return Number(v);
      return invalid(baseType, v);
    }
    case "numeric":
    case "double precision":
    case "real": {
      if (typeof v === "number") return v;
      if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
      if (typeof v === "string" && /^(nan|infinity|-infinity)$/i.test(v.trim())) return Number(v.trim().replace(/^nan$/i, "NaN").replace(/infinity/i, "Infinity"));
      return invalid(baseType, v);
    }
    case "boolean": {
      if (typeof v === "boolean") return v;
      if (typeof v === "string") {
        const s = v.trim();
        if (BOOL_TRUE.test(s)) return true;
        if (BOOL_FALSE.test(s)) return false;
      }
      return invalid(baseType, v);
    }
    case "timestamptz":
    case "timestamp":
      return toTimestamp(v, baseType);
    case "date": {
      const iso = toTimestamp(v, "date");
      return iso === "infinity" || iso === "-infinity" ? iso : iso.slice(0, 10);
    }
    case "jsonb":
    case "json": {
      if (fromText) {
        if (typeof v !== "string") return clone(v);
        try {
          return JSON.parse(v);
        } catch {
          throw new PgException(`invalid input syntax for type json`, "22P02", `Token "${v}" is invalid.`);
        }
      }
      return clone(v);
    }
    case "text":
      return textOf(v);
    default:
      return typeof v === "object" ? clone(v) : v;
  }
}

/** Value as it is stored for `col` when written through the API (JSON body semantics). */
export function coerceWrite(col: ColumnDef, value: unknown, schema: Schema): unknown {
  if (value === null || value === undefined) return null;
  if (col.isArray) {
    let arr: unknown[] | null = null;
    if (Array.isArray(value)) arr = value;
    else if (typeof value === "string") arr = parsePgArrayLiteral(value);
    if (!arr) throw new PgException(`malformed array literal: "${textOf(value)}"`, "22P02", 'Array value must start with "{" or dimension information.');
    return arr.map((x) => coerceScalar(col.baseType, x, schema, typeof value === "string"));
  }
  return coerceScalar(col.baseType, value, schema, false);
}

/** Parses a filter literal (text on the wire) for `col`'s type. */
export function coerceFilterText(col: ColumnDef, text: string, schema: Schema): unknown {
  if (col.isArray) {
    const arr = parsePgArrayLiteral(text);
    if (!arr) throw new PgException(`malformed array literal: "${text}"`, "22P02", 'Array value must start with "{" or dimension information.');
    return arr.map((x) => coerceScalar(col.baseType, x, schema, true));
  }
  return coerceScalar(col.baseType, text, schema, true);
}

/** Sort / comparison key of a stored (canonical) non-null value. */
export function sortKey(col: ColumnDef | null, v: unknown, schema: Schema): number | string | boolean {
  if (col) {
    const enumValues = schema.enums.get(col.baseType);
    if (enumValues && !col.isArray && typeof v === "string") return enumValues.indexOf(v);
    if (!col.isArray && (TIME_TYPES.has(col.baseType) || col.baseType === "date") && typeof v === "string") {
      if (v === "infinity") return Number.POSITIVE_INFINITY;
      if (v === "-infinity") return Number.NEGATIVE_INFINITY;
      const ms = Date.parse(v);
      return Number.isNaN(ms) ? v : ms;
    }
  }
  if (typeof v === "number" || typeof v === "string") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  return JSON.stringify(v);
}

function cmpKeys(a: number | string | boolean, b: number | string | boolean): number {
  if (typeof a === "number" && typeof b === "number") return a < b ? -1 : a > b ? 1 : 0;
  const sa = String(a);
  const sb = String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

/** Compares two non-null canonical values of `col` (arrays element-wise). */
export function compareTyped(col: ColumnDef | null, a: unknown, b: unknown, schema: Schema): number {
  if (Array.isArray(a) && Array.isArray(b)) {
    const el: ColumnDef | null = col ? { ...col, isArray: false, type: col.baseType } : null;
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      if (a[i] === null && b[i] === null) continue;
      if (a[i] === null) return 1;
      if (b[i] === null) return -1;
      const c = compareTyped(el, a[i], b[i], schema);
      if (c !== 0) return c;
    }
    return a.length - b.length;
  }
  return cmpKeys(sortKey(col, a, schema), sortKey(col, b, schema));
}

/** Typed equality of two non-null canonical values. */
export function equalTyped(col: ColumnDef | null, a: unknown, b: unknown, schema: Schema): boolean {
  if (typeof a === "object" || typeof b === "object") return deepEqual(a, b);
  return compareTyped(col, a, b, schema) === 0;
}

/** Text form of a canonical value (used for LIKE / casts to text). */
export function textForm(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "true" : "false";
  if (Array.isArray(v)) return `{${v.map((x) => (x === null ? "NULL" : typeof x === "string" && /[,{}"\s\\]/.test(x) ? `"${x.replace(/["\\]/g, "\\$&")}"` : textForm(x))).join(",")}}`;
  if (v && typeof v === "object") return JSON.stringify(v);
  return String(v);
}
