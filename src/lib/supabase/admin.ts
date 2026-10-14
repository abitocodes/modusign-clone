import "server-only";

import { createClient } from "@supabase/supabase-js";

import { PREVIEW } from "@/lib/preview/flag";
import { createPreviewAdminClient } from "@/lib/preview/server-client";

function supabaseAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Service-role client. Bypasses RLS — use ONLY on the server, and only for
 * flows that are authorised by other means (e.g. a signer's access token).
 */
export function createAdminClient() {
  // preview mode (`npm run dev:preview`, never in a production build): in-memory mock backend
  if (PREVIEW) return createPreviewAdminClient() as unknown as ReturnType<typeof supabaseAdminClient>;
  return supabaseAdminClient();
}
