"use client";

import { createBrowserClient } from "@supabase/ssr";

import { createPreviewBrowserClient } from "@/lib/preview/browser-client";
import { PREVIEW } from "@/lib/preview/flag";

function supabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

export function createClient() {
  // preview mode (`npm run dev:preview`, never in a production build): in-memory mock backend
  if (PREVIEW) return createPreviewBrowserClient() as unknown as ReturnType<typeof supabaseBrowserClient>;
  return supabaseBrowserClient();
}
