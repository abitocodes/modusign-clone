# OpenSign — project conventions

Internal (사내 전용) e-signature service with a dark-theme web UI.
Stack: **Next.js 16.4 (App Router, Turbopack) · React 19 · TypeScript · Tailwind CSS v4 · Supabase (Auth/Postgres/Storage)**.

@AGENTS.md

## Product rules (from the user)
- Login is **ID/password only** (Supabase email+password; "아이디" may be a username mapped to the e-mail). No social login, no phone/identity verification, **no public sign-up**. Employee accounts are created by admins in 통합 설정 > 멤버 (server-side `auth.admin.createUser`).
- External people do not log in: they receive an e-mail link and sign at `/sign/[token]` (e-mail identity check first).
- **No subscription/billing/quota UI anywhere** (no trial banner, no "잔여 N건", no 요금제/결제/쿠폰 pages, no "차감" wording, no sign-up promotions).
- Match layout/colours/spacing/Korean copy of the reference screens closely, but use **original** code, icons (lucide-react) and illustrations (simple inline SVG). Never copy any third party's logo images, illustrations or legal/business info; use "OpenSign" placeholders. Never put real people's names/e-mails in seed/demo data.

## Specs (read before building a screen)
Kept outside the repository (they hold captured reference screens and are never committed) — ask the maintainer for the local `spec\` folder, which contains:
`00-REQUIREMENTS.md` (overrides everything), `tokens.md`, `01…11-*.md`; each spec links screenshots in `spec\screens\` — open them with the Read tool and match them.

## Next.js 16 specifics
- `middleware.ts` is now **`src/proxy.ts`** (already handles session refresh + auth redirects; public prefixes: /login, /sign/, /link/, /api/sign/).
- `params`, `searchParams`, `cookies()`, `headers()` are **async** — `const { wid } = await params`. Use the global helpers `PageProps<'/workspaces/[wid]/…'>` / `LayoutProps<…>` (run `npx next typegen` after adding routes).
- `cacheComponents` is **off** (classic dynamic rendering). Server Actions body limit is 12 MB.
- Tailwind v4: CSS-first config in `src/app/globals.css` (no tailwind.config). Read docs in `node_modules/next/dist/docs/` when unsure.

## Design tokens (Tailwind classes — always use these, never raw hex)
Surfaces: `bg-body` #121212, `bg-body-2` #191919 (main area of home/settings), `bg-surface` #212121 (cards, header, sidebar, list pages), `bg-surface-2` #242424, `bg-surface-3` #262626 (filter bars), `bg-surface-4` #2b2b2b, `bg-modal` #292929, `bg-modal-head`, `bg-modal-foot`, `bg-menu` #383838, `bg-menu-hover` #434343.
Buttons: `bg-primary` #856d00 / `hover:bg-primary-hover` #705c00 + `text-primary-fg`; `bg-btn-light` #2e2e2e, `bg-btn-base` #3c3c3c, `bg-btn-dark` #434343, `bg-btn-hover`, `bg-btn-disabled`.
Lines: `border-line-faint` #292929, `border-line-light` #383838, `border-line` #474747, `border-line-strong` #575757.
Text: `text-fg-strong`, `text-fg` #e8e8e8, `text-fg-2` #d9d9d9, `text-fg-3` #c9c9c9, `text-fg-muted` #a3a3a3, `text-fg-faint` #949494, `text-fg-disabled` #848484; icons `text-icon`, `text-icon-2`.
Semantic: `emphasis` (#5991f4, bg `emphasis-bg` #202b3f, border `emphasis-border` #043da1), `positive*`, `negative*`, `warning*` (#ffcb4c, bg #363021, border #5f5540), `neutral-badge-*`, `radio-on`. Participant colours `bg-p1`…`bg-p10` / `participantColor(i)` in `@/lib/utils`.
Shadows: `shadow-menu`, `shadow-modal`, `shadow-card`, `shadow-input`, `shadow-focus`, `shadow-button`, `shadow-toast`. Font: Pretendard (default).

## Building blocks (reuse, don't duplicate)
- UI: `@/components/ui/button` (Button variants primary|neutral|light|outline|ghost|secondary|danger, sizes xs|sm|md|lg; IconButton), `ui/input` (Input, SearchInput, Textarea, Select, TextField (floating label), FilledField), `ui/controls` (Checkbox, Radio, Switch, ProgressBar, Avatar), `ui/modal` (Modal, ConfirmModal), `ui/menu` (Dropdown, MenuItem, MenuDivider, SelectMenu), `ui/tabs` (UnderlineTabs, Segmented), `ui/badge` (StatusBadge, FilterChip, CountPill, Chip), `ui/list-page` (ListPage, ListTitle, FilterBar, TableHeader, TableRow, Cell, EmptyRows, Pagination, PageSizeSelect, paginate). Toasts: `import { toast } from "sonner"`.
- Shell: `components/shell/*` — `ESignShell` (header) is applied by `app/workspaces/[wid]/esign/layout.tsx`; sidebars via `ESignSidebar` + `REQUESTS_SIDEBAR`/`DOCUMENTS_SIDEBAR` in the section layouts. `useWorkspace()` gives `{ profile, workspace, role, workspaces }`; `useWsPath()` builds `/workspaces/<id>/…` links.
- Server data: `@/lib/data/session` (`getSessionProfile`, `getWorkspaceContext(wid)`, `getMyWorkspaces`).
- Supabase: `@/lib/supabase/server` (RLS, current user — default for everything), `@/lib/supabase/client` (browser), `@/lib/supabase/admin` (service role — ONLY for token-authorised signer flows, admin user management, mail/event logging; always authorise first).
- Types: `@/lib/types` (row types for every table). Utils: `@/lib/utils` (`cn`, date formatters `fmtDate/fmtDateTime/fmtShort/fmtDashDateTime/isoDay`, `documentBadge`, `docMatchesFilter`, `DOC_FILTER_LABELS`, `participantColor`, `withAlpha`, `koreanOrdinal`).
- PDF (client): `@/components/pdf/pdf` — `usePdfDocument(urlOrBytes)`, `PdfPageView`, `PdfThumbnail`, `readPdfInfo(arrayBuffer)`, `renderPdfThumbnail`. Field coordinates are **PDF points from the page's top-left**; on screen multiply by `scale = displayedWidth / pageWidthPts` (page width 816px for A4 at "100%").
- Fields: `@/lib/fields` (`FIELD_META` labels/icons/default sizes, `FIELD_ORDER`), `@/components/fields/field-value` (`FieldValue` renders a filled value).
- Storage: bucket `documents`, path helpers in `@/lib/storage` (`paths.documentOriginal(wid,did)` …, `MAX_PDF_BYTES`); server helpers `@/lib/storage-server` (`signedUrl`, `downloadBytes`, `uploadBytes`). Browser uploads use the user's session (RLS = workspace membership, first path segment = workspace id).
- Mail: `@/lib/email/mailer` (`sendMail`, `appUrl`), templates `@/lib/email/templates` (`signRequestEmail`, `completedEmail`, `rejectedEmail`, `cancelledEmail`, `reminderEmail`, `emailLayout`, `maskName`, `maskEmail`). Local Mailpit UI: http://127.0.0.1:54324.
- Audit trail: `@/lib/events` (`logEvent(docId, type, actor, {auto})`, `describeEvent`, `requestMeta`).
- Wizard chrome: `@/components/wizard/wizard-header` (`WizardHeader`, `WizardNextButton`).

## Route map (keep links consistent)
- `/login` · `/` → default workspace home
- `/workspaces/[wid]/esign/home`
- `/workspaces/[wid]/esign/requests/{request,templates,bulk-requests,links,signatures,approvals,approval-processes,custom-fields,address-book,editing-documents,drafts}`
- `/workspaces/[wid]/esign/documents/documents?status=<DocFilter>` · `/esign/documents/data-export` · `/esign/documents/reminders`
- Wizard: `/workspaces/[wid]/documents/d/upload` → `/workspaces/[wid]/documents/d/[docId]/steps/1|2|3` → `/workspaces/[wid]/documents/d/completed?doc=<id>`
- Document viewer (requester/member, read-only + downloads): `/workspaces/[wid]/documents/[docId]`
- Downloads: `/api/documents/[docId]/download?type=original|completed` (logged-in) · `/api/sign/[token]/download` (signer)
- Signer (public): `/sign/[token]` (token = `participants.access_token`). Internal users who must sign open the same URL.
- Link sign (public): `/link/[token]` · Templates: `/workspaces/[wid]/templates/new`, `/workspaces/[wid]/templates/[tid]/edit`
- Settings: `/workspaces/[wid]/settings/workspace/{info,members,groups,roles,security,audit-log}`, `/settings/esign/{automatic-sharing,…}`, `/settings/personal/{member,password,notifications}`
- Dev: `/dev/mailbox` (outbound_emails viewer — logged-in owners/admins of the team workspace only)

## Cross-area contracts
- `src/lib/server/send.ts` — `sendDocument(documentId: string, opts?: { actor?: {name,email} }): Promise<{ ok: true } | { ok: false; error: string }>` (server-only, caller must be authorised): validates, sets participants (sequential: first `pending`, rest `waiting`; parallel: all `pending`), `expires_at`, `sent_at`, document `in_progress` + `requested_at`, logs `created`/`sent` events, e-mails pending participants with `signRequestEmail` linking to `appUrl('/sign/'+access_token)`.
- `src/components/editor/field-editor.tsx` — reusable `FieldEditor` (used by wizard step 2 and template editor).
- `src/components/signature/*` — `SignatureDialog` / `StampDialog` / `SignMethodPicker` (used by 사인·도장 page and signer flow).
- `src/lib/pdf/finalize.ts` — builds the completed PDF (pdf-lib + `@pdf-lib/fontkit`, Pretendard OTF from `node_modules/pretendard/dist/public/static/Pretendard-Regular.otf`) and stores it at `paths.documentCompleted`.
- Completion (signer area): when the last signer signs, compute SHA-256 of the completed PDF (store in a new column `documents.completed_hash`), build the 감사 추적 인증서 also as a SEPARATE PDF, and send `completedEmail({ …, documentId, hash })` to every participant, the requester and cc recipients with `sendMail({ …, attachments: [{ filename: title+'.pdf', content: completedBytes }, { filename: '감사 추적 인증서.pdf', content: auditBytes }] })`. Completed documents show the badge "완료" with a check icon (handled by `documentBadge` + `StatusBadge`).
- `src/lib/server/send.ts` also exports `dispatchScheduled(workspaceId: string)` — sends `scheduled` documents whose `scheduled_at` has passed (no cron; the 문서함 page calls it on load) — and `expireOverdue(workspaceId)` (in-progress requests past a pending signer's deadline → `signing_cancelled`). Every send issues fresh `access_token`s.
- Security model (migration `20261014030000_security_hardening`): `participants.access_token`, `auth_password` and `draft_values` are not readable/writable with the RLS client (column privileges) — read them with the admin client after authorising; own sign links come from `loadMyPendingTokens` (`my_pending_sign_tokens` RPC). participants/fields are writable only by the requester/admin while the document is `draft`/`on_modifying`; user-session updates of `documents` are limited by the `guard_document_change` trigger (cancel / 내용 수정 go through the `doc_cancel_request` / `doc_start_modify` RPCs); `document_events` and `completed.pdf`/`audit.pdf` are written by the server only; stored storage paths must be canonical (service-role code rebuilds paths from ids).
- Template use: `/workspaces/[wid]/templates/[tid]/use` (route handler / page) creates a draft document from the template (copies PDF, roles → empty participants, fields) and redirects to wizard step 1. The wizard's "준비된 템플릿으로 시작" cards link there.
- Signer reject entry: `/sign/[token]?action=reject` opens the reject dialog directly (문서함 panel "거절" links there).
- Fonts for client-side PDF generation (pdf-lib + fontkit): `/fonts/Pretendard-Regular.otf`, `/fonts/Pretendard-Bold.otf`.
- Auto-fill text fields: `options.autoFill: 'name' | 'company' | 'address'` — editor creates them from the "자동 입력" tab; the signer flow pre-fills `name` with the participant name (company/address left for the signer to type).

## Working rules for agents
- Own only the files of your area; don't rewrite shared foundation files (`components/ui`, `components/shell`, `lib/*`, `globals.css`, migrations init). If a tiny shared fix is unavoidable, keep it backward compatible and mention it in your report.
- DB changes: add a NEW migration `supabase/migrations/2026101401xxxx_<area>.sql`; never edit `20261014000000_init.sql`. Apply with `npx supabase migration up` (local) and regenerate nothing else.
- Don't install npm packages, don't run `next dev`/`next build` (another process owns the dev server on :3000). Verify with `npx tsc --noEmit` and `npx eslint <your files>`.
- Server Actions live in `actions.ts` files next to the route (`"use server"`), validate input, check membership/role, and `revalidatePath` what they change.
- All UI copy in Korean. Dates via the util formatters. Keyboard/a11y basics (labels, roles, Escape closes modals).
- Local test accounts (seed): `admin` / `Admin1234!` (owner), `minsu` / `Test1234!`, `seoyeon` / `Test1234!` — local dev only.
