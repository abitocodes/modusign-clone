/**
 * Preview auth (mock GoTrue): accounts live in the preview database's `meta` (HMR-safe, reset with
 * the demo data); the session is the `mc_preview_uid` cookie (see server-client.ts).
 *
 *  * signInWithPassword accepts ANY credentials: a seeded / created account matching the e-mail or
 *    아이디 signs in as that account, anything else as the demo admin
 *  * auth.admin.createUser runs the logic of the `handle_new_user` trigger (profile, company
 *    membership, personal workspace) in one transaction
 *  * error messages / codes follow GoTrue where the app inspects them
 *
 * No "@/…" or "server-only" imports: also used by src/proxy.ts and testable under plain Node.
 */
import { DEMO, DEMO_ADMIN_ID } from "./demo";
import { previewGlobals } from "./engine/db";
import type { PreviewDb, PreviewSession, Row } from "./types";

export interface AuthUserRecord {
  id: string;
  email: string;
  password: string | null;
  phone: string;
  user_metadata: Record<string, unknown>;
  app_metadata: Record<string, unknown>;
  email_confirmed_at: string | null;
  last_sign_in_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Shape of a supabase-js `User` (the fields the app reads, plus the usual ones). */
export interface PreviewUser {
  id: string;
  aud: string;
  role: string;
  email: string;
  phone: string;
  email_confirmed_at: string | null;
  confirmed_at: string | null;
  last_sign_in_at: string | null;
  app_metadata: Record<string, unknown>;
  user_metadata: Record<string, unknown>;
  identities: unknown[];
  created_at: string;
  updated_at: string;
  is_anonymous: boolean;
}

export interface PreviewAuthSession {
  access_token: string;
  refresh_token: string;
  token_type: "bearer";
  expires_in: number;
  expires_at: number;
  user: PreviewUser;
}

/** supabase-js AuthError look-alike (`isAuthError()` checks `__isAuthError`). */
export class PreviewAuthError extends Error {
  status: number;
  code: string;
  __isAuthError = true;
  constructor(message: string, status: number, code: string, name = "AuthApiError") {
    super(message);
    this.name = name;
    this.status = status;
    this.code = code;
  }
  toJSON() {
    return { name: this.name, message: this.message, status: this.status, code: this.code };
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const META_KEY = "authUsers";

export const isUuidLike = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

const nowIso = () => new Date().toISOString();
const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

/** The account store (on the db's meta: dropped by resetPreviewDb together with the data). */
export function authUsers(db: Pick<PreviewDb, "meta">): Map<string, AuthUserRecord> {
  let m = db.meta[META_KEY] as Map<string, AuthUserRecord> | undefined;
  if (!(m instanceof Map)) {
    m = new Map();
    db.meta[META_KEY] = m;
  }
  return m;
}

export function toUser(rec: AuthUserRecord): PreviewUser {
  return {
    id: rec.id,
    aud: "authenticated",
    role: "authenticated",
    email: rec.email,
    phone: rec.phone,
    email_confirmed_at: rec.email_confirmed_at,
    confirmed_at: rec.email_confirmed_at,
    last_sign_in_at: rec.last_sign_in_at,
    app_metadata: clone(rec.app_metadata),
    user_metadata: clone(rec.user_metadata),
    identities: [],
    created_at: rec.created_at,
    updated_at: rec.updated_at,
    is_anonymous: false,
  };
}

export function toSession(rec: AuthUserRecord): PreviewAuthSession {
  const expiresIn = 60 * 60 * 24 * 30;
  return {
    access_token: `preview.${rec.id}`,
    refresh_token: `preview.${rec.id}`,
    token_type: "bearer",
    expires_in: expiresIn,
    expires_at: Math.floor(Date.now() / 1000) + expiresIn,
    user: toUser(rec),
  };
}

/** The data-API session of an account id (anon when it does not exist). */
export function sessionOf(db: PreviewDb, userId: string | null): PreviewSession {
  const rec = userId ? authUsers(db).get(userId) : undefined;
  return rec ? { role: "authenticated", userId: rec.id, email: rec.email } : { role: "anon", userId: null, email: null };
}

/** GoTrue merges metadata: keys with a null value are removed. */
function mergeMeta(base: Record<string, unknown>, patch: unknown): Record<string, unknown> {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return base;
  const out = { ...base };
  for (const [k, v] of Object.entries(clone(patch as Record<string, unknown>))) {
    if (v === null) delete out[k];
    else out[k] = v;
  }
  return out;
}

/* ------------------------------------------------------------ handle_new_user */

/** `raw_user_meta_data ->> key` */
function metaText(meta: Record<string, unknown>, key: string): string | null {
  const v = meta[key];
  if (v === null || v === undefined) return null;
  return typeof v === "string" ? v : JSON.stringify(v);
}
const nullIfEmpty = (s: string | null) => (s === null || s === "" ? null : s);

/** Fixed ids for the seed (otherwise gen_random_uuid() like the trigger). */
export interface ProvisionPreset {
  companyWorkspaceId?: string;
  personalWorkspaceId?: string;
  createdAt?: string;
}

/** public.handle_new_user(): profile → company membership (first team workspace) → personal workspace. */
function handleNewUser(tx: PreviewDb, rec: AuthUserRecord, preset: ProvisionPreset) {
  const meta = rec.user_metadata ?? {};
  const name = nullIfEmpty(metaText(meta, "name")) ?? rec.email.split("@")[0];
  const at = preset.createdAt;
  tx.insert("profiles", {
    id: rec.id,
    email: rec.email.toLowerCase(),
    username: nullIfEmpty(metaText(meta, "username")?.toLowerCase() ?? null),
    name,
    department: nullIfEmpty(metaText(meta, "department")),
    position: nullIfEmpty(metaText(meta, "position")),
    ...(at ? { created_at: at } : {}),
  });

  const teams = tx
    .rows("workspaces")
    .filter((w) => w.type === "team")
    .sort((a, b) => Date.parse(a.created_at as string) - Date.parse(b.created_at as string));
  let company = teams[0]?.id as string | undefined;
  let role: string;
  if (!company) {
    const ws = tx.insert("workspaces", {
      ...(preset.companyWorkspaceId ? { id: preset.companyWorkspaceId } : {}),
      name: `${nullIfEmpty(metaText(meta, "company")) ?? "사내"} 워크스페이스`,
      type: "team",
      owner_id: rec.id,
      ...(at ? { created_at: at } : {}),
    });
    company = ws.id as string;
    role = "owner";
  } else {
    role = nullIfEmpty(metaText(meta, "role")) ?? "member";
  }
  tx.insert("workspace_members", { workspace_id: company, user_id: rec.id, role, is_default: true, ...(at ? { joined_at: at } : {}) });

  const personal = tx.insert("workspaces", {
    ...(preset.personalWorkspaceId ? { id: preset.personalWorkspaceId } : {}),
    name,
    type: "personal",
    owner_id: rec.id,
    ...(at ? { created_at: at } : {}),
  });
  tx.insert("workspace_members", { workspace_id: personal.id, user_id: rec.id, role: "owner", is_default: false, ...(at ? { joined_at: at } : {}) });
}

export interface NewUserInput {
  id?: string;
  email?: string;
  password?: string;
  phone?: string;
  email_confirm?: boolean;
  user_metadata?: Record<string, unknown>;
  app_metadata?: Record<string, unknown>;
}

/** auth.admin.createUser: account + the handle_new_user trigger, atomically. Throws PreviewAuthError. */
export function createAuthUser(db: PreviewDb, input: NewUserInput, preset: ProvisionPreset = {}): AuthUserRecord {
  const email = String(input?.email ?? "").trim().toLowerCase();
  if (!email || !EMAIL_RE.test(email)) throw new PreviewAuthError("Unable to validate email address: invalid format", 400, "validation_failed");
  if (input.password !== undefined && String(input.password).length < 6) {
    throw new PreviewAuthError("Password should be at least 6 characters.", 422, "weak_password", "AuthWeakPasswordError");
  }
  const users = authUsers(db);
  for (const u of users.values()) {
    if (u.email === email) throw new PreviewAuthError("A user with this email address has already been registered", 422, "email_exists");
  }
  const id = input.id && isUuidLike(input.id) ? input.id.toLowerCase() : db.uuid();
  if (users.has(id)) throw new PreviewAuthError("A user with this ID already exists", 422, "user_already_exists");
  const at = preset.createdAt ?? nowIso();
  const rec: AuthUserRecord = {
    id,
    email,
    password: input.password !== undefined ? String(input.password) : null,
    phone: input.phone ?? "",
    user_metadata: mergeMeta({}, input.user_metadata),
    app_metadata: { provider: "email", providers: ["email"], ...mergeMeta({}, input.app_metadata) },
    email_confirmed_at: input.email_confirm ? at : null,
    last_sign_in_at: null,
    created_at: at,
    updated_at: at,
  };
  try {
    db.transaction((tx) => handleNewUser(tx, rec, preset));
  } catch (e) {
    console.warn("[preview] handle_new_user failed:", (e as Error)?.message ?? e);
    throw new PreviewAuthError("Database error creating new user", 500, "unexpected_failure");
  }
  users.set(id, rec);
  return rec;
}

/** auth.admin.deleteUser: the profile row goes with it (FK cascades of the public tables apply). */
export function deleteAuthUser(db: PreviewDb, id: string) {
  const users = authUsers(db);
  const key = isUuidLike(id) ? id.toLowerCase() : "";
  if (!users.has(key)) throw new PreviewAuthError("User not found", 404, "user_not_found");
  try {
    db.transaction((tx) => tx.remove("profiles", (p) => p.id === key));
  } catch (e) {
    console.warn("[preview] deleting the profile failed:", (e as Error)?.message ?? e);
    throw new PreviewAuthError("Database error deleting user", 500, "unexpected_failure");
  }
  users.delete(key);
}

export interface UserAttributes {
  email?: string;
  password?: string;
  phone?: string;
  data?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
  app_metadata?: Record<string, unknown>;
  email_confirm?: boolean;
}

function applyAttributes(db: PreviewDb, rec: AuthUserRecord, attrs: UserAttributes, admin: boolean): AuthUserRecord {
  const a = attrs ?? {};
  if (a.password !== undefined) {
    const pw = String(a.password);
    if (pw.length < 6) throw new PreviewAuthError("Password should be at least 6 characters.", 422, "weak_password", "AuthWeakPasswordError");
    if (!admin && rec.password !== null && pw === rec.password) {
      throw new PreviewAuthError("New password should be different from the old password.", 422, "same_password");
    }
  }
  if (a.email !== undefined) {
    const email = String(a.email).trim().toLowerCase();
    if (!EMAIL_RE.test(email)) throw new PreviewAuthError("Unable to validate email address: invalid format", 400, "validation_failed");
    for (const u of authUsers(db).values()) {
      if (u.id !== rec.id && u.email === email) throw new PreviewAuthError("A user with this email address has already been registered", 422, "email_exists");
    }
  }
  const next: AuthUserRecord = {
    ...rec,
    email: a.email !== undefined ? String(a.email).trim().toLowerCase() : rec.email,
    password: a.password !== undefined ? String(a.password) : rec.password,
    phone: a.phone !== undefined ? String(a.phone) : rec.phone,
    user_metadata: mergeMeta(rec.user_metadata, admin ? a.user_metadata : a.data),
    app_metadata: admin ? mergeMeta(rec.app_metadata, a.app_metadata) : rec.app_metadata,
    email_confirmed_at: admin && a.email_confirm ? (rec.email_confirmed_at ?? nowIso()) : rec.email_confirmed_at,
    updated_at: nowIso(),
  };
  authUsers(db).set(rec.id, next);
  return next;
}

/* ------------------------------------------------------------- login lookup */

/** The demo admin (seeded owner), else the owner of the company workspace, else any account. */
function demoAdmin(db: PreviewDb): AuthUserRecord | null {
  const users = authUsers(db);
  const fixed = users.get(DEMO_ADMIN_ID);
  if (fixed) return fixed;
  const team = db
    .rows("workspaces")
    .filter((w) => w.type === "team")
    .sort((a, b) => Date.parse(a.created_at as string) - Date.parse(b.created_at as string))[0];
  const owner = team ? users.get(team.owner_id as string) : undefined;
  return owner ?? users.values().next().value ?? null;
}

/** Preview login: matching e-mail or 아이디, otherwise the demo admin. */
export function resolvePreviewLogin(db: PreviewDb, login: string | null | undefined): AuthUserRecord | null {
  const l = String(login ?? "").trim().toLowerCase();
  const users = authUsers(db);
  if (l) {
    for (const u of users.values()) if (u.email === l) return u;
    const profile = db.rows("profiles").find((p: Row) => typeof p.username === "string" && p.username === l);
    const byName = profile ? users.get(profile.id as string) : undefined;
    if (byName) return byName;
  }
  return demoAdmin(db);
}

/* ------------------------------------------------------------------ client API */

type Ok<T> = { data: T; error: null };
type Fail<T> = { data: T; error: PreviewAuthError };

function failWith<T>(empty: T, e: unknown): Fail<T> {
  if (e instanceof PreviewAuthError) return { data: empty, error: e };
  console.warn("[preview] auth error:", e);
  return { data: empty, error: new PreviewAuthError((e as Error)?.message ?? String(e), 500, "unexpected_failure") };
}

export interface AuthDeps {
  /** the (seeded) preview database */
  db: () => Promise<PreviewDb>;
  /** current session's account id (null = signed out) */
  getUserId: () => string | null;
  /** persists a new session (cookie on the server, nothing for in-memory clients) */
  setUserId: (id: string | null) => void;
}

const missingSession = () => new PreviewAuthError("Auth session missing!", 400, "session_missing", "AuthSessionMissingError");

/** `supabase.auth` of a preview client. */
export function createAuthApi(deps: AuthDeps) {
  const current = async (): Promise<{ db: PreviewDb; rec: AuthUserRecord | null }> => {
    const db = await deps.db();
    const id = deps.getUserId();
    return { db, rec: id ? (authUsers(db).get(id) ?? null) : null };
  };

  const admin = {
    async createUser(attrs: NewUserInput) {
      try {
        const db = await deps.db();
        const rec = createAuthUser(db, attrs ?? {});
        return { data: { user: toUser(rec) }, error: null } as Ok<{ user: PreviewUser }>;
      } catch (e) {
        return failWith<{ user: null }>({ user: null }, e);
      }
    },
    async deleteUser(id: string, _shouldSoftDelete?: boolean) {
      void _shouldSoftDelete;
      try {
        const db = await deps.db();
        deleteAuthUser(db, id);
        return { data: { user: null }, error: null } as Ok<{ user: null }>;
      } catch (e) {
        return failWith<{ user: null }>({ user: null }, e);
      }
    },
    async getUserById(id: string) {
      const db = await deps.db();
      const rec = isUuidLike(id) ? authUsers(db).get(id.toLowerCase()) : undefined;
      if (!rec) return failWith<{ user: null }>({ user: null }, new PreviewAuthError("User not found", 404, "user_not_found"));
      return { data: { user: toUser(rec) }, error: null } as Ok<{ user: PreviewUser }>;
    },
    async updateUserById(id: string, attrs: UserAttributes) {
      try {
        const db = await deps.db();
        const rec = isUuidLike(id) ? authUsers(db).get(id.toLowerCase()) : undefined;
        if (!rec) throw new PreviewAuthError("User not found", 404, "user_not_found");
        return { data: { user: toUser(applyAttributes(db, rec, attrs, true)) }, error: null } as Ok<{ user: PreviewUser }>;
      } catch (e) {
        return failWith<{ user: null }>({ user: null }, e);
      }
    },
    async listUsers(params?: { page?: number; perPage?: number }) {
      const db = await deps.db();
      const all = [...authUsers(db).values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
      const perPage = Math.max(1, Math.min(1000, Math.floor(params?.perPage ?? 50)));
      const page = Math.max(1, Math.floor(params?.page ?? 1));
      const users = all.slice((page - 1) * perPage, page * perPage).map(toUser);
      const lastPage = Math.max(1, Math.ceil(all.length / perPage));
      return { data: { users, aud: "authenticated", nextPage: page < lastPage ? page + 1 : null, lastPage, total: all.length }, error: null };
    },
  };

  return {
    admin,
    async getUser(_jwt?: string) {
      void _jwt;
      const { rec } = await current();
      if (!rec) {
        const error = deps.getUserId()
          ? new PreviewAuthError("User from sub claim in JWT does not exist", 403, "user_not_found")
          : missingSession();
        return { data: { user: null }, error } as Fail<{ user: null }>;
      }
      return { data: { user: toUser(rec) }, error: null } as Ok<{ user: PreviewUser }>;
    },
    async getSession() {
      const { rec } = await current();
      return { data: { session: rec ? toSession(rec) : null }, error: null };
    },
    async getClaims() {
      const { rec } = await current();
      if (!rec) return { data: null, error: missingSession() };
      return { data: { claims: { sub: rec.id, email: rec.email, role: "authenticated", aud: "authenticated" }, header: {}, signature: new Uint8Array() }, error: null };
    },
    /** Preview: ANY credentials sign in (matching account, else the demo admin). */
    async signInWithPassword(credentials: { email?: string; phone?: string; password?: string }) {
      try {
        const db = await deps.db();
        const rec = resolvePreviewLogin(db, credentials?.email ?? credentials?.phone ?? "");
        if (!rec) throw new PreviewAuthError("Invalid login credentials", 400, "invalid_credentials");
        const signedIn = { ...rec, last_sign_in_at: nowIso() };
        authUsers(db).set(rec.id, signedIn);
        deps.setUserId(rec.id);
        return { data: { user: toUser(signedIn), session: toSession(signedIn) }, error: null } as Ok<{ user: PreviewUser; session: PreviewAuthSession }>;
      } catch (e) {
        return failWith<{ user: null; session: null }>({ user: null, session: null }, e);
      }
    },
    async signOut(_options?: { scope?: "global" | "local" | "others" }) {
      void _options;
      deps.setUserId(null);
      return { error: null };
    },
    async updateUser(attrs: UserAttributes) {
      try {
        const { db, rec } = await current();
        if (!rec) throw missingSession();
        return { data: { user: toUser(applyAttributes(db, rec, attrs, false)) }, error: null } as Ok<{ user: PreviewUser }>;
      } catch (e) {
        return failWith<{ user: null }>({ user: null }, e);
      }
    },
    async refreshSession() {
      const { rec } = await current();
      return { data: { user: rec ? toUser(rec) : null, session: rec ? toSession(rec) : null }, error: rec ? null : missingSession() };
    },
    onAuthStateChange(_cb: unknown) {
      void _cb;
      return { data: { subscription: { id: "preview", callback: () => undefined, unsubscribe: () => undefined } } };
    },
  };
}

export type PreviewAuthApi = ReturnType<typeof createAuthApi>;

/* ------------------------------------------------------------------- proxy */

/**
 * What a session cookie means for src/proxy.ts, without creating or seeding the database:
 *  * "valid"      — an account of the live store (or a demo account, re-seeded on first use)
 *  * "unverified" — a well-formed id while this process has no database yet (the pages decide)
 *  * "none"       — no / malformed cookie, or an account that does not exist (any more)
 */
export function previewCookieSession(value: string | null | undefined): "valid" | "unverified" | "none" {
  if (!isUuidLike(value)) return "none";
  const id = value.toLowerCase();
  const state = previewGlobals().db;
  const users = state?.meta?.[META_KEY];
  if (state?.meta?.previewSeeded && users instanceof Map) return users.has(id) ? "valid" : "none";
  return (Object.values(DEMO.users) as string[]).includes(id) ? "valid" : "unverified";
}
