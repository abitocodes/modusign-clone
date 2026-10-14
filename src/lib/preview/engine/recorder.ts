/**
 * Chainable, thenable query builders with the supabase-js surface. Every call is recorded as a
 * `ChainCall`; nothing runs until the builder is awaited (`then`), when the op goes to `execute`
 * (the engine on the server, a POST to /api/preview/data in the browser).
 *
 * Like postgrest-js: `from()` gives a fresh builder; the verb (select/insert/upsert/update/delete)
 * clones it, every later call mutates and returns the same builder (`query = query.eq(…)` works),
 * awaiting twice executes twice, and results never reject unless `.throwOnError()` was called.
 *
 * Browser-safe: no imports besides types.
 */
import type { ChainCall, DataOp, PgError, PgResult, PreviewQueryBuilder } from "../types";

export type ExecuteFn = (op: DataOp) => Promise<PgResult>;

/** Same shape as supabase-js PostgrestError. */
export class PreviewPostgrestError extends Error {
  details: string;
  hint: string;
  code: string;
  constructor(e: PgError) {
    super(e.message);
    this.name = "PostgrestError";
    this.details = e.details ?? "";
    this.hint = e.hint ?? "";
    this.code = e.code;
  }
}

const VERBS = new Set(["select", "insert", "upsert", "update", "delete"]);
/** type-level / transport-only helpers: not recorded */
const SKIP = new Set(["returns", "overrideTypes", "abortSignal", "setHeader", "retry"]);

const METHODS = [
  // verbs
  "select",
  "insert",
  "upsert",
  "update",
  "delete",
  // filters
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "like",
  "likeAllOf",
  "likeAnyOf",
  "ilike",
  "ilikeAllOf",
  "ilikeAnyOf",
  "regexMatch",
  "regexIMatch",
  "is",
  "isDistinct",
  "in",
  "notIn",
  "contains",
  "containedBy",
  "rangeGt",
  "rangeGte",
  "rangeLt",
  "rangeLte",
  "rangeAdjacent",
  "overlaps",
  "textSearch",
  "match",
  "not",
  "or",
  "filter",
  // transforms
  "order",
  "limit",
  "range",
  "single",
  "maybeSingle",
  "csv",
  "geojson",
  "explain",
  "rollback",
  "maxAffected",
  "stripNulls",
  "throwOnError",
  // no-ops
  "returns",
  "overrideTypes",
  "abortSignal",
  "setHeader",
  "retry",
] as const;

type Base = { kind: "from"; table: string } | { kind: "rpc"; fn: string; args: Record<string, unknown>; options?: { head?: boolean; get?: boolean; count?: string } };

function fetchErrorResult(e: unknown): PgResult {
  const err = e as { name?: string; message?: string };
  return {
    data: null,
    error: { message: `${err?.name ?? "FetchError"}: ${err?.message ?? String(e)}`, details: "", hint: "", code: "" },
    count: null,
    status: 0,
    statusText: "",
    success: false,
  };
}

/** Removes `undefined` (JSON semantics) but keeps everything else as given. */
function recordArgs(args: unknown[]): unknown[] {
  let end = args.length;
  while (end > 0 && args[end - 1] === undefined) end--;
  return args.slice(0, end);
}

class Builder {
  [method: string]: unknown;
  private _exec: ExecuteFn;
  private _base: Base;
  private _chain: ChainCall[];
  private _throw: boolean;

  constructor(exec: ExecuteFn, base: Base, chain: ChainCall[] = [], throwOnError = false) {
    this._exec = exec;
    this._base = base;
    this._chain = chain;
    this._throw = throwOnError;
    for (const m of METHODS) {
      Object.defineProperty(this, m, {
        enumerable: false,
        configurable: true,
        writable: true,
        value: (...args: unknown[]) => this._call(m, args),
      });
    }
  }

  private _call(m: string, args: unknown[]): Builder {
    if (SKIP.has(m)) return this;
    if (m === "throwOnError") {
      this._throw = true;
      this._chain.push({ m, a: [] });
      return this;
    }
    const call: ChainCall = { m, a: recordArgs(args) };
    // the first verb starts a new request (postgrest-js: QueryBuilder.select() returns a new FilterBuilder)
    if (VERBS.has(m) && this._base.kind === "from" && !this._chain.some((c) => VERBS.has(c.m))) {
      return new Builder(this._exec, this._base, [...this._chain, call], this._throw);
    }
    this._chain.push(call);
    return this;
  }

  /** The op this builder would execute now. */
  toOp(): DataOp {
    const chain = this._chain.map((c) => ({ m: c.m, a: [...c.a] }));
    if (this._base.kind === "from") return { kind: "from", table: this._base.table, chain };
    return { kind: "rpc", fn: this._base.fn, args: this._base.args, ...(this._base.options ? { options: this._base.options } : {}), chain };
  }

  then<R1 = PgResult, R2 = never>(
    onfulfilled?: ((value: PgResult) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): Promise<R1 | R2> {
    const shouldThrow = this._throw;
    let p: Promise<PgResult>;
    try {
      p = Promise.resolve(this._exec(this.toOp()));
    } catch (e) {
      p = Promise.reject(e);
    }
    const settled = p.then(
      (res) => {
        if (shouldThrow && res.error) throw new PreviewPostgrestError(res.error);
        return res;
      },
      (e) => {
        if (shouldThrow) throw e;
        return fetchErrorResult(e);
      },
    );
    return settled.then(onfulfilled, onrejected);
  }

  catch<R = never>(onrejected?: ((reason: unknown) => R | PromiseLike<R>) | null): Promise<PgResult | R> {
    return this.then(undefined, onrejected);
  }

  finally(onfinally?: (() => void) | null): Promise<PgResult> {
    return this.then().finally(onfinally ?? undefined);
  }
}

export interface Recorder {
  from(table: string): PreviewQueryBuilder;
  rpc(fn: string, args?: Record<string, unknown>, options?: { head?: boolean; get?: boolean; count?: "exact" | "planned" | "estimated" }): PreviewQueryBuilder;
}

/** Creates `{ from, rpc }` whose builders hand their recorded op to `execute` when awaited. */
export function createRecorder(execute: ExecuteFn): Recorder {
  return {
    from(table: string) {
      return new Builder(execute, { kind: "from", table }) as unknown as PreviewQueryBuilder;
    },
    rpc(fn: string, args: Record<string, unknown> = {}, options?: { head?: boolean; get?: boolean; count?: "exact" | "planned" | "estimated" }) {
      const opts = options && (options.head || options.get || options.count) ? { ...(options.head ? { head: true } : {}), ...(options.get ? { get: true } : {}), ...(options.count ? { count: options.count } : {}) } : undefined;
      return new Builder(execute, { kind: "rpc", fn, args, ...(opts ? { options: opts } : {}) }) as unknown as PreviewQueryBuilder;
    },
  };
}
