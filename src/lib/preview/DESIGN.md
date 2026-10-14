# Preview mode — design contract

`npm run dev:preview` runs the app with **no Supabase, no Docker, no SMTP**. All data lives in an
in-memory mock backend that emulates exactly the parts of supabase-js the app uses. It exists so that
every screen can be clicked through with fake data, including the external signer side.

Gate: `PREVIEW` from `src/lib/preview/flag.ts` (`NEXT_PUBLIC_PREVIEW_MODE === "1"` AND `NODE_ENV !== "production"`).
Production builds and normal `npm run dev` never activate any of this (route handlers return 404, UI renders nothing).

## Layout (src/lib/preview/)
| module | owner | purpose |
|---|---|---|
| `flag.ts`, `types.ts`, `DESIGN.md` | done | gate + shared contracts |
| `engine/schema.ts` | engine | parse `supabase/migrations/*.sql` (sorted) → `Schema`: tables, columns (type, nullable, default factory), PK, unique, FKs (`<table>_<col>_fkey`), enums; `alter table … add column`, `drop column`, `alter column … set default` handled |
| `engine/db.ts` | engine | `PreviewDb` on `globalThis.__mcPreview` (survives HMR): defaults, PK/unique checks (error code `23505`), FK `on delete cascade` / `set null` on remove, `now()`/`gen_random_uuid()`/literal/`'…'::jsonb`/arrays defaults |
| `engine/select.ts` | engine | PostgREST select parser: `*`, `a, b`, `alias:col`, `rel(…)`, `alias:rel(…)`, `rel!fkey_name(…)`, `rel!inner(…)`, nested; embed resolution via FKs both directions (many-to-one → object|null, one-to-many → array) |
| `engine/filters.ts` | engine | `eq neq gt gte lt lte like ilike is in contains containedBy overlaps not match filter or` (incl. PostgREST `or("a.eq.1,and(b.gt.2,c.is.null)")`, quoted values, `referencedTable`/`foreignTable` option), filters on embedded columns `rel.col` (with `!inner` dropping parents) |
| `engine/execute.ts` | engine | `executeDataOp(op: DataOp, session): Promise<PgResult>` — select/insert/upsert(onConflict, ignoreDuplicates)/update/delete + returning select, order (incl. `referencedTable`, nullsFirst), limit, range, single/maybeSingle (`PGRST116`), count exact + head, `throwOnError` |
| `engine/recorder.ts` | engine | `createRecorder(execute: (op) => Promise<PgResult>)` → `{ from(table), rpc(fn, args, opts) }` returning chainable thenable builders that record `ChainCall[]` and call `execute` on `then` |
| `rpc/*.ts` + `rpc/index.ts` | platform | `RPCS: Record<string, RpcImpl>` mirroring EVERY SQL function the app calls via `.rpc(...)` (read their SQL bodies in the migrations; same arguments, return shape and error messages/codes the callers check) |
| `auth.ts` | platform | session from cookie `mc_preview_uid`; `getUser`, `signInWithPassword` (preview: ANY id/password → logs in; matching seeded user by e-mail/username else the demo admin), `signOut`, `updateUser`, `admin.{createUser (runs the handle_new_user logic), deleteUser, getUserById, updateUserById, listUsers}` |
| `storage.ts` | platform | in-memory buckets: `upload`, `download` (Blob), `createSignedUrl(s)` → `/api/preview/storage?bucket=…&path=…&exp=…&sig=…`, `remove`, `copy`, `move`, `list`, `getBucket`, `listBuckets`, `getPublicUrl` |
| `seed.ts` | platform | demo company/users/documents/templates/contacts/labels/approvals/… + sample PDFs generated with pdf-lib + Pretendard (public/fonts) — fictional data only |
| `server-client.ts` | platform | `createPreviewServerClient(cookies: CookieAdapter)`, `createPreviewAdminClient()` → `{ from, rpc, storage, auth }` |
| `browser-client.ts` | platform | `createPreviewBrowserClient()` — same surface; serialises ops to `POST /api/preview/data`, storage uploads as FormData to `/api/preview/storage` |
| `src/app/api/preview/[...op]/route.ts` | platform | executes browser ops with the cookie session; 404 unless PREVIEW |
| hook points | platform | `src/lib/supabase/{server,client,admin}.ts`, `src/proxy.ts`, `src/app/workspaces/[wid]/settings/personal/password/actions.ts`, `src/lib/email/mailer.ts` (no SMTP in preview; still logs) |
| UI (`src/components/preview/*`) | ui | `PreviewBadge`, login hint, signer shortcuts, "서명 완료 처리 (미리보기)", identity-check skip, auto-fill — all render `null` unless PREVIEW |

## Rules
- No RLS emulation (single demo company); but the app's own explicit filters must work exactly.
- Results must have the same shapes supabase-js gives (arrays for list selects, object for single, `count` when requested, `error` null on success).
- Unknown table/column/RPC → return a PgError (`42P01`, `42703`, `PGRST202`) and `console.warn("[preview] …")` so gaps are visible.
- Never in a bundle outside preview: app code imports preview UI ONLY from the gateway `@/components/preview` (`src/components/preview/index.ts`). Outside preview mode `next.config.ts` (`turbopack.resolveAlias`) swaps it for `disabled.ts` and `@/lib/preview/browser-client` for `browser-client-disabled.ts` — a cross-module `PREVIEW` constant is NOT folded by the bundler, so a plain `{PREVIEW && <X />}` alone would still ship X. New client-side preview exports go into both `index.ts` and `disabled.ts` (typed against each other). `src/proxy.ts` answers `/api/preview/*` with 404 outside preview.
- Checks: `npm run test:preview` (click-through E2E against `npm run dev:preview`), `npm run test:preview-engine` (engine self-test); after `next build`, `.next/static` must not contain "미리보기 모드" / "서명 완료 처리 (미리보기)".
- Never touch the network: `scripts/dev-preview.mjs` overrides `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:9` and `SMTP_HOST=` so an accidental real client fails fast instead of hitting the cloud project.
- `.next-preview` dist dir (next.config `distDir` from `NEXT_DIST_DIR`) so `dev` and `dev:preview` can run side by side; preview runs on port 3100.
