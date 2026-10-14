/**
 * Preview engine — public API (server side). See src/lib/preview/DESIGN.md.
 *
 * Browser code must import `./recorder` directly (this index pulls in the whole engine and the
 * RPC registry). Nothing here imports "@/…" or "server-only", and the migrations are read through
 * process.getBuiltinModule, so the engine also runs under plain `node --experimental-strip-types`.
 */
export { executeDataOp, executeOn, chainToRequest } from "./execute";
export type { ExecuteOptions } from "./execute";
export { createRecorder, PreviewPostgrestError } from "./recorder";
export type { ExecuteFn, Recorder } from "./recorder";
export { Db, asEngineDb, createDbState, createPreviewDb, getPreviewDb, previewGlobals, registerTrigger, resetPreviewDb } from "./db";
export type { DbState, PreviewGlobals, UpsertOptions } from "./db";
export { loadSchemaFromDir, parseSchema } from "./schema";
export type { MigrationFile } from "./schema";
export { BUILTIN_TRIGGERS } from "./triggers";
export type { TriggerDef, TriggerEvent, TriggerOp } from "./triggers";
export { PgException, errorResult, httpStatusFor, okResult, pgError, raise, toPgError } from "./errors";
export { buildPlan, parseSelect, resolveRelation } from "./select";
export { compileFilter, parseFilterParam, parseLogic } from "./filters";
export { coerceWrite } from "./values";
export { clone, nowIso, uuid } from "./util";
