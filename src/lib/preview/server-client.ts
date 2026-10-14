import "server-only";

/**
 * Server-side preview clients: the same surface the app uses from supabase-js (`from`, `rpc`,
 * `storage`, `auth`), executed against the in-memory preview database.
 *
 *  * createPreviewServerClient(cookies) — the user's session from the `mc_preview_uid` cookie
 *    (src/lib/supabase/server.ts)
 *  * createPreviewAdminClient()        — service role (src/lib/supabase/admin.ts)
 *  * createPreviewStandaloneClient()   — anonymous, in-memory session only (e.g. the password
 *    verifier of 비밀번호 변경); never touches cookies
 */
import { createAuthApi, isUuidLike, sessionOf } from "./auth";
import { errorResult, toPgError } from "./engine/errors";
import { executeDataOp } from "./engine/execute";
import { createRecorder } from "./engine/recorder";
import { ensureSeeded } from "./seed";
import { createStorageApi } from "./storage";
import { PREVIEW_SESSION_COOKIE, type CookieAdapter, type DataOp, type PgResult, type PreviewSession } from "./types";

const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

/** Origin of the current request (signed storage URLs must be absolute and same-origin). */
export async function requestOrigin(): Promise<string> {
  try {
    const { headers } = await import("next/headers");
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    if (host) return `${h.get("x-forwarded-proto") ?? "http"}://${host}`;
  } catch {
    // outside a request scope
  }
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3100").replace(/\/$/, "");
}

async function execute(op: DataOp, session: () => Promise<PreviewSession>): Promise<PgResult> {
  let who: PreviewSession;
  try {
    who = await session();
  } catch (e) {
    console.error("[preview] demo database unavailable:", e);
    return errorResult(toPgError(e, "seed"));
  }
  return executeDataOp(op, who);
}

interface ClientOptions {
  getUserId: () => string | null;
  setUserId: (id: string | null) => void;
  role: "user" | "service_role";
}

function createClient(opts: ClientOptions) {
  const session = async (): Promise<PreviewSession> => {
    const db = await ensureSeeded();
    if (opts.role === "service_role") return { role: "service_role", userId: null, email: null };
    return sessionOf(db, opts.getUserId());
  };
  const recorder = createRecorder((op) => execute(op, session));
  const auth = createAuthApi({ db: ensureSeeded, getUserId: opts.getUserId, setUserId: opts.setUserId });
  const storage = createStorageApi({
    db: ensureSeeded,
    ownerId: () => {
      if (opts.role === "service_role") return null;
      const id = opts.getUserId();
      return id && isUuidLike(id) ? id : null;
    },
    origin: requestOrigin,
  });
  return {
    from: recorder.from,
    rpc: recorder.rpc,
    schema: () => ({ from: recorder.from, rpc: recorder.rpc }),
    storage,
    auth,
    /** realtime is not part of preview mode */
    channel: () => ({ on: () => ({ subscribe: () => undefined }), subscribe: () => undefined, unsubscribe: async () => "ok" }),
    removeChannel: async () => "ok",
  };
}

export type PreviewClient = ReturnType<typeof createClient>;

/** The user's client: session = the `mc_preview_uid` cookie (an id of a preview account). */
export function createPreviewServerClient(cookies: CookieAdapter): PreviewClient {
  const raw = cookies.get(PREVIEW_SESSION_COOKIE);
  let uid: string | null = raw && isUuidLike(raw) ? raw.toLowerCase() : null;
  return createClient({
    role: "user",
    getUserId: () => uid,
    setUserId: (id) => {
      uid = id;
      try {
        if (id) cookies.set(PREVIEW_SESSION_COOKIE, id, { path: "/", httpOnly: true, sameSite: "lax", maxAge: SESSION_MAX_AGE });
        else cookies.set(PREVIEW_SESSION_COOKIE, "", { path: "/", httpOnly: true, sameSite: "lax", maxAge: 0 });
      } catch {
        // Server Components cannot set cookies (the in-memory session still changes)
      }
    },
  });
}

/** Service-role client (bypasses everything, like the real one). */
export function createPreviewAdminClient(): PreviewClient {
  return createClient({ role: "service_role", getUserId: () => null, setUserId: () => undefined });
}

/** Anonymous client with an in-memory session (no cookies), e.g. a password verifier. */
export function createPreviewStandaloneClient(): PreviewClient {
  let uid: string | null = null;
  return createClient({
    role: "user",
    getUserId: () => uid,
    setUserId: (id) => {
      uid = id;
    },
  });
}

/** Runs a serialised data op of the browser client with the cookie session (/api/preview/data). */
export function executePreviewOp(op: DataOp, cookies: CookieAdapter): Promise<PgResult> {
  const raw = cookies.get(PREVIEW_SESSION_COOKIE);
  const uid = raw && isUuidLike(raw) ? raw.toLowerCase() : null;
  return execute(op, async () => sessionOf(await ensureSeeded(), uid));
}

/** Cookie adapter over next/headers `cookies()` (writes fail silently in Server Components). */
export function nextCookieAdapter(store: {
  get(name: string): { value: string } | undefined;
  set(name: string, value: string, options?: Record<string, unknown>): unknown;
}): CookieAdapter {
  return {
    get: (name) => store.get(name)?.value,
    set: (name, value, options) => {
      try {
        store.set(name, value, options);
      } catch {
        // read-only cookie store (Server Component)
      }
    },
  };
}
