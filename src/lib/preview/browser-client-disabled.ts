/**
 * Stand-in for `@/lib/preview/browser-client` outside preview mode (next.config.ts
 * `turbopack.resolveAlias`), so the mock's browser client never ships in a real bundle.
 * `@/lib/supabase/client` only calls it when PREVIEW is on, which cannot happen in that case.
 */
import type * as Real from "./browser-client";

export const createPreviewBrowserClient: typeof Real.createPreviewBrowserClient = () => {
  throw new Error("preview mode is not enabled");
};
