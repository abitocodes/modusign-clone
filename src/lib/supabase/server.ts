import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { PREVIEW } from "@/lib/preview/flag";
import { createPreviewServerClient, nextCookieAdapter } from "@/lib/preview/server-client";

type CookieStore = Awaited<ReturnType<typeof cookies>>;

function supabaseServerClient(cookieStore: CookieStore) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Called from a Server Component — the proxy refreshes the session instead.
          }
        },
      },
    },
  );
}

/** Supabase client bound to the current user's session (RLS applies). */
export async function createClient() {
  const cookieStore = await cookies();
  // preview mode (`npm run dev:preview`, never in a production build): in-memory mock backend
  if (PREVIEW) return createPreviewServerClient(nextCookieAdapter(cookieStore)) as unknown as ReturnType<typeof supabaseServerClient>;
  return supabaseServerClient(cookieStore);
}
