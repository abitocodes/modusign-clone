/** Small helpers shared by the preview engine (no imports: usable anywhere). */

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function uuid(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  // fallback (RFC 4122 v4 layout)
  const h = "0123456789abcdef";
  let s = "";
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) s += "-";
    else if (i === 14) s += "4";
    else if (i === 19) s += h[(Math.random() * 4) | 8];
    else s += h[(Math.random() * 16) | 0];
  }
  return s;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** Deep copy of JSON-like data (rows, jsonb values, arrays). */
export function clone<T>(v: T): T {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map((x) => clone(x)) as T;
  if (v instanceof Date) return new Date(v.getTime()) as T;
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = clone(x);
  return out as T;
}

/** Same as supabase-js: the request body goes through JSON.stringify (drops undefined, Dates → ISO strings, bigint → string). */
export function jsonRoundTrip<T>(v: T): T {
  if (v === undefined) return v;
  const text = JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));
  return text === undefined ? (undefined as T) : (JSON.parse(text) as T);
}

/** Structural equality for JSON-like values. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    return a.length === bb.length && a.every((x, i) => deepEqual(x, bb[i]));
  }
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/** jsonb `@>` containment semantics. */
export function jsonContains(container: unknown, contained: unknown): boolean {
  if (Array.isArray(container)) {
    if (Array.isArray(contained)) return contained.every((c) => container.some((x) => jsonContains(x, c)));
    // an array contains a primitive (top-level special case)
    if (contained === null || typeof contained !== "object") return container.some((x) => deepEqual(x, contained));
    return false;
  }
  if (isPlainObject(container)) {
    if (!isPlainObject(contained)) return false;
    return Object.entries(contained).every(
      ([k, v]) => Object.prototype.hasOwnProperty.call(container, k) && jsonContains(container[k], v),
    );
  }
  return deepEqual(container, contained);
}

/** Splits `s` on `sep` at depth 0, honouring "double quotes" (with \" escapes), (parens) and {braces}. */
export function splitTopLevel(s: string, sep = ","): string[] {
  const out: string[] = [];
  let depth = 0;
  let quoted = false;
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      cur += c;
      if (c === "\\" && i + 1 < s.length) {
        cur += s[++i];
      } else if (c === '"') quoted = false;
      continue;
    }
    if (c === '"') {
      quoted = true;
      cur += c;
      continue;
    }
    if (c === "(" || c === "{" || c === "[") depth++;
    else if (c === ")" || c === "}" || c === "]") depth--;
    if (c === sep && depth === 0) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

/** Removes surrounding "double quotes" (PostgREST value quoting) and unescapes \" and \\. */
export function unquote(s: string): string {
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    return s.slice(1, -1).replace(/\\(.)/g, "$1");
  }
  return s;
}

/** Parses a Postgres array literal `{a,"b c",NULL}` (one dimension) into strings / null. */
export function parsePgArrayLiteral(s: string): (string | null)[] | null {
  const t = s.trim();
  if (!t.startsWith("{") || !t.endsWith("}")) return null;
  const body = t.slice(1, -1);
  if (body.trim() === "") return [];
  return splitTopLevel(body).map((part) => {
    const p = part.trim();
    if (p.startsWith('"')) return unquote(p);
    if (/^null$/i.test(p)) return null;
    return p;
  });
}
