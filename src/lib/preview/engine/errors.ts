/**
 * PostgREST / Postgres error helpers of the preview engine.
 * Engine modules must stay free of "@/…" and "server-only" imports (testable with node --experimental-strip-types).
 */
import type { PgError, PgResult } from "../types";

/** An error carrying a PostgREST-shaped `PgError` (thrown by the db layer and by RPC implementations). */
export class PgException extends Error {
  pg: PgError;
  constructor(message: string, code: string, details: string | null = null, hint: string | null = null) {
    super(message);
    this.name = "PgException";
    this.pg = { message, code, details, hint };
  }
}

/** Builds a PgError object. */
export function pgError(message: string, code = "P0001", details: string | null = null, hint: string | null = null): PgError {
  return { message, code, details, hint };
}

/** Throws like plpgsql `raise exception '<message>' using errcode = '<code>'`. */
export function raise(message: string, code = "P0001", details: string | null = null): never {
  throw new PgException(message, code, details);
}

function isPgErrorLike(e: unknown): e is PgError {
  return !!e && typeof e === "object" && typeof (e as PgError).message === "string" && typeof (e as PgError).code === "string";
}

/** Converts anything thrown inside the engine / an RPC into a PgError (unknown errors → XX000 + console.warn). */
export function toPgError(e: unknown, context = ""): PgError {
  if (e instanceof PgException) return { ...e.pg };
  if (isPgErrorLike(e)) {
    return { message: e.message, code: e.code, details: e.details ?? null, hint: e.hint ?? null };
  }
  const message = e instanceof Error ? e.message : String(e);
  console.warn(`[preview] internal error${context ? ` (${context})` : ""}:`, e);
  return { message, code: "XX000", details: null, hint: null };
}

const STATUS_TEXT: Record<number, string> = {
  200: "OK",
  201: "Created",
  204: "No Content",
  206: "Partial Content",
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  406: "Not Acceptable",
  409: "Conflict",
  416: "Requested Range Not Satisfiable",
  500: "Internal Server Error",
};

export function statusText(status: number): string {
  return STATUS_TEXT[status] ?? "";
}

/** HTTP status PostgREST answers with for a given SQLSTATE / PGRST code. */
export function httpStatusFor(code: string): number {
  if (code === "23505" || code === "23503") return 409;
  if (code === "42501") return 403;
  if (code === "42P01" || code === "PGRST202" || code === "PGRST205") return 404;
  if (code === "PGRST116") return 406;
  if (code === "PGRST103") return 416;
  if (code === "XX000") return 500;
  return 400;
}

export function okResult(data: unknown, status = 200, count: number | null = null): PgResult {
  return { data: data === undefined ? null : data, error: null, count, status, statusText: statusText(status), success: true };
}

export function errorResult(error: PgError, status = httpStatusFor(error.code)): PgResult {
  return { data: null, error, count: null, status, statusText: statusText(status), success: false };
}
