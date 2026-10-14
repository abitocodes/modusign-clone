/**
 * Preview RPC registry: every SQL function the app calls via `.rpc(name, args)`, implemented on
 * the in-memory database from the function bodies in supabase/migrations (same parameters, return
 * shapes, verdict strings and error messages / SQLSTATEs the callers check).
 *
 * Unknown names are answered by the engine with PGRST202 and a `[preview]` warning.
 * Modules here import specific engine files only (execute.ts imports this file).
 */
import type { RpcImpl } from "../types";

import { APPROVAL_RPCS } from "./approvals";
import { BULK_RPCS } from "./bulk";
import { DOCUMENT_RPCS } from "./documents";
import { SETTINGS_RPCS } from "./settings";

export const RPCS: Record<string, RpcImpl> = {
  ...DOCUMENT_RPCS,
  ...APPROVAL_RPCS,
  ...SETTINGS_RPCS,
  ...BULK_RPCS,
};
