/**
 * Self-test of the preview engine against the REAL migrations.
 *
 *   node scripts/preview-engine-selftest.mjs [--verbose]
 *
 * Covers: schema parsing, defaults, constraint errors (23505 / 23503 / 23502 / 23514 / 22P02),
 * upsert, update/delete returning, every `.from("…").select(…)` string found in src/, embeds
 * (both directions, aliases, !fkey hints, !inner + embedded filters), or()/not()/in/contains/
 * ilike, order (referencedTable, nullsFirst), range, count/head, single/maybeSingle, cascades,
 * triggers, transactions/undo, RPC dispatch, the recorder and the browser (JSON) round trip.
 * Not part of the app bundle (nothing imports it).
 */
import type { DataOp, PgResult, PreviewSession, Row, RpcImpl } from "../types";
import { Db, asEngineDb, createPreviewDb, getPreviewDb, previewGlobals, registerTrigger, resetPreviewDb } from "./db";
import { PgException } from "./errors";
import { executeDataOp } from "./execute";
import { createRecorder } from "./recorder";
import { loadSchemaFromDir } from "./schema";
import { buildPlan, parseSelect } from "./select";
import { deepEqual, uuid } from "./util";

type Fs = { readFileSync(p: string, e: "utf8"): string; readdirSync(p: string, o: { withFileTypes: true }): { name: string; isDirectory(): boolean }[] };
type PathMod = { join(...p: string[]): string; relative(a: string, b: string): string };

const proc = (globalThis as unknown as { process: { cwd(): string; getBuiltinModule(id: string): unknown } }).process;
const fs = proc.getBuiltinModule("node:fs") as Fs;
const path = proc.getBuiltinModule("node:path") as PathMod;
const ROOT = proc.cwd();

let passed = 0;
let failed = 0;
let VERBOSE = false;
const failures: string[] = [];

class AssertionError extends Error {}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new AssertionError(msg);
}
function assertEq(actual: unknown, expected: unknown, msg: string) {
  if (!deepEqual(actual, expected)) throw new AssertionError(`${msg}\n      expected: ${JSON.stringify(expected)}\n      actual:   ${JSON.stringify(actual)}`);
}
function ok(res: PgResult, msg: string): PgResult {
  if (res.error) throw new AssertionError(`${msg}: unexpected error ${res.error.code} ${res.error.message} ${res.error.details ?? ""}`);
  return res;
}
function errCode(res: PgResult, code: string, msg: string) {
  if (!res.error) throw new AssertionError(`${msg}: expected error ${code}, got data ${JSON.stringify(res.data)?.slice(0, 200)}`);
  if (res.error.code !== code) throw new AssertionError(`${msg}: expected ${code}, got ${res.error.code} ${res.error.message}`);
}

async function test(name: string, fn: () => unknown | Promise<unknown>) {
  try {
    await fn();
    passed++;
    if (VERBOSE) console.log(`  ok   ${name}`);
  } catch (e) {
    failed++;
    const msg = e instanceof AssertionError ? e.message : (e as Error)?.stack ?? String(e);
    failures.push(`${name}: ${msg}`);
    console.log(`  FAIL ${name}\n      ${msg}`);
  }
}

const ADMIN: PreviewSession = { role: "service_role", userId: null, email: null };

// ---------------------------------------------------------------------------------------------
// select strings used by the app (scanned from src/)
// ---------------------------------------------------------------------------------------------

function walk(dir: string, out: string[]) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (p.includes(path.join("lib", "preview"))) continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
}

/** Every `.from("<table>")…select(<literal or known constant>)` in src/ (one chain per match). */
export function scanAppSelects(): { file: string; table: string; select: string }[] {
  const files: string[] = [];
  walk(path.join(ROOT, "src"), files);
  const constants: Record<string, string> = {};
  for (const f of files) {
    const text = fs.readFileSync(f, "utf8");
    const re = /export const ([A-Z_]+_COLUMNS)\s*=\s*\n?\s*"([^"]*)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) constants[m[1]] = m[2];
  }
  const found: { file: string; table: string; select: string }[] = [];
  for (const f of files) {
    const text = fs.readFileSync(f, "utf8");
    const re = /\.from\(\s*"([a-z_]+)"\s*\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      // the chain continues until the next ";" / ".from(" — look for the select inside it
      const rest = text.slice(m.index + m[0].length, m.index + m[0].length + 1500);
      const stop = rest.search(/;|\.from\(/);
      const chain = stop >= 0 ? rest.slice(0, stop) : rest;
      const sm = /\.select\(\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`|([A-Z_]+_COLUMNS)|\)|,)/.exec(chain);
      if (!sm) continue;
      let sel: string;
      if (sm[1] !== undefined) sel = sm[1];
      else if (sm[2] !== undefined) sel = sm[2];
      else if (sm[3] !== undefined) sel = sm[3].replace(/\$\{([A-Z_]+_COLUMNS)\}/g, (_x, k: string) => constants[k] ?? "");
      else if (sm[4] !== undefined) sel = constants[sm[4]] ?? "";
      else sel = "*";
      found.push({ file: path.relative(ROOT, f), table: m[1], select: sel });
    }
  }
  return found;
}

// ---------------------------------------------------------------------------------------------
// the test
// ---------------------------------------------------------------------------------------------

export async function runSelfTest(opts: { verbose?: boolean } = {}): Promise<boolean> {
  VERBOSE = !!opts.verbose;
  passed = 0;
  failed = 0;
  failures.length = 0;
  const t0 = Date.now();
  // expected "[preview] …" gap warnings (unknown column / RPC tests) are collected, printed with --verbose
  const realWarn = console.warn;
  const warnings: string[] = [];
  console.warn = (...a: unknown[]) => {
    const line = a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ");
    warnings.push(line);
    if (VERBOSE || !line.startsWith("[preview]")) realWarn(...a);
  };
  try {
    return await runAll(t0, warnings);
  } finally {
    console.warn = realWarn;
  }
}

async function runAll(t0: number, warnings: string[]): Promise<boolean> {
  const schema = loadSchemaFromDir(path.join(ROOT, "supabase", "migrations"), { warn: true });
  const db: Db = createPreviewDb(schema);

  // test RPCs (the real registry lives in src/lib/preview/rpc; these exercise the dispatch contract)
  const rpcs: Record<string, RpcImpl> = {
    echo_rows: async (_ctx, args) => ({ data: [{ id: 1, name: "b", n: 2 }, { id: 2, name: "a", n: 1 }, { id: 3, name: String(args.extra ?? "c"), n: 3 }], error: null }),
    void_fn: async () => ({ data: undefined, error: null }),
    scalar_fn: async (_ctx, args) => ({ data: `hello ${String(args.who)}`, error: null }),
    write_then_fail: async (ctx, args) => {
      const { error } = await ctx.from("labels").insert({ workspace_id: args.wid, name: "rpc-label" });
      if (error) return { data: null, error };
      ctx.db.insert("labels", { workspace_id: args.wid, name: "rpc-label-2" });
      return { data: null, error: { message: "not_found", code: "P0001", details: null, hint: null } };
    },
    write_then_throw: async (ctx, args) => {
      await ctx.from("labels").insert({ workspace_id: args.wid, name: "rpc-label-3" });
      throw new PgException("owner_only", "42501");
    },
    write_ok: async (ctx, args) => {
      const { data, error } = await ctx.from("labels").insert({ workspace_id: args.wid, name: "rpc-ok" }).select("id, name").single();
      if (error) return { data: null, error };
      const nested = await ctx.rpc("scalar_fn", { who: "nested" });
      return { data: { label: data, nested: nested.data }, error: null };
    },
  };

  const asUser = (userId: string, email: string): PreviewSession => ({ role: "authenticated", userId, email });
  const client = (session: PreviewSession = ADMIN) => createRecorder((op) => executeDataOp(op, session, { db, rpcs }));
  /** like the browser client: the op crosses JSON before it is executed */
  const browser = (session: PreviewSession) => createRecorder((op) => executeDataOp(JSON.parse(JSON.stringify(op)) as DataOp, session, { db, rpcs }));
  const sb = client();
  /** heterogeneous rows go one by one (a bulk insert would NULL the missing keys, like PostgREST) */
  const insertEach = async (table: string, rows: Row[]) => {
    for (const r of rows) ok(await sb.from(table).insert(r), `insert ${table}`);
  };

  console.log(`preview engine self-test — ${schema.tables.size} tables, ${schema.enums.size} enums`);

  // ------------------------------------------------------------------ schema
  await test("schema: tables, enums, keys and constraints from the real migrations", () => {
    for (const t of ["profiles", "workspaces", "workspace_members", "documents", "participants", "fields", "document_events", "templates", "template_pins", "groups", "group_members", "approvals", "approval_events", "approval_lines", "participant_identity_attempts", "link_sign_attempts", "link_signs", "bulk_sends", "signatures", "contacts", "custom_fields", "labels", "drafts", "editing_documents", "outbound_emails", "workspace_invites"]) {
      assert(schema.tables.has(t), `table ${t} missing`);
    }
    assertEq(schema.enums.get("doc_status"), ["draft", "on_modifying", "scheduled", "in_progress", "completed", "rejected", "signing_cancelled", "request_cancelled"], "doc_status enum");
    const docs = schema.tables.get("documents")!;
    for (const c of ["attachments", "cc", "completed_hash", "audit_file_path", "link_sign_id", "finalizing_at", "finalize_error"]) assert(docs.columns.has(c), `documents.${c} (alter table add column)`);
    assert(schema.tables.get("participants")!.columns.has("role_label"), "participants.role_label");
    assert(schema.tables.get("participants")!.columns.has("draft_values"), "participants.draft_values");
    assert(schema.tables.get("signatures")!.columns.get("shared")?.nullable === false, "signatures.shared not null");
    assertEq(schema.tables.get("workspace_members")!.primaryKey, ["workspace_id", "user_id"], "composite PK");
    const fk = schema.tables.get("approvals")!.foreignKeys.find((f) => f.name === "approvals_drafter_id_fkey");
    assert(fk && fk.table === "profiles" && fk.onDelete === "cascade", "approvals_drafter_id_fkey");
    assert(schema.tables.get("approvals")!.foreignKeys.some((f) => f.name === "approvals_line_id_fkey" && f.onDelete === "set null"), "approvals.line_id FK from alter table add column");
    assert(!schema.tables.get("profiles")!.foreignKeys.length, "FK to auth.users is not modelled");
    const cf = schema.tables.get("custom_fields")!.uniqueKeys.find((u) => u.name === "custom_fields_name_uniq");
    assertEq(cf?.parts, [{ column: "workspace_id", fns: [] }, { column: "name", fns: ["lower"] }], "expression unique index lower(name)");
    const gk = schema.tables.get("groups")!.uniqueKeys.find((u) => u.name === "groups_workspace_name_key");
    assertEq(gk?.parts[1], { column: "name", fns: ["btrim", "lower"] }, "lower(btrim(name))");
    assert(schema.tables.get("participants")!.uniqueKeys.some((u) => u.name === "participants_access_token_key"), "inline unique");
    assert(schema.tables.get("link_sign_attempts")!.columns.get("id")!.sequence, "bigserial sequence");
    const checks = [...schema.tables.values()].flatMap((t) => t.checks);
    assert(checks.length >= 15, `checks parsed (${checks.length})`);
    assert(checks.every((c) => c.test), `every check compiled: ${checks.filter((c) => !c.test).map((c) => c.name).join(", ")}`);
    assert(!schema.tables.get("signatures")!.checks.some((c) => c.name === "x"), "dropped constraints");
    assertEq((schema as unknown as { warnings: string[] }).warnings, [], "no schema warnings");
  });

  // ------------------------------------------------------------------ seed through the API
  const U = { admin: uuid(), minsu: uuid(), seoyeon: uuid(), outsider: uuid() };
  const W = { company: uuid(), personal: uuid(), other: uuid() };
  const T = { tpl1: uuid(), tpl2: uuid() };
  const D = { draft: uuid(), sent: uuid(), done: uuid(), scheduled: uuid(), otherWs: uuid() };

  await test("insert profiles/workspaces/members (defaults applied, explicit ids)", async () => {
    const r = ok(
      await sb
        .from("profiles")
        .insert([
          { id: U.admin, email: "admin@example.test", username: "admin", name: "관리자" },
          { id: U.minsu, email: "minsu@example.test", username: "minsu", name: "김민수", department: "영업" },
          { id: U.seoyeon, email: "seoyeon@example.test", username: "seoyeon", name: "이서연" },
          { id: U.outsider, email: "outsider@example.test", name: "외부인" },
        ])
        .select("id, avatar_color, created_at, username, department"),
      "insert profiles",
    );
    const rows = r.data as Row[];
    assertEq(rows.length, 4, "4 profiles returned");
    assertEq(rows[0].avatar_color, "#ffe0b2", "text default");
    assert(typeof rows[0].created_at === "string" && !Number.isNaN(Date.parse(rows[0].created_at as string)), "now() default");
    // bulk insert with defaultToNull (columns = union of keys): department missing → null
    assertEq(rows[0].department, null, "bulk insert: missing key → null");
    assertEq(r.status, 201, "insert status 201");
    // bulk insert with heterogeneous keys: missing keys become NULL (supabase-js defaultToNull=true → columns=…)
    const hetero = await sb.from("workspaces").insert([
      { id: W.company, name: "OpenSign 워크스페이스", owner_id: U.admin },
      { id: W.personal, name: "관리자", type: "personal", owner_id: U.admin },
    ]);
    errCode(hetero, "23502", "heterogeneous bulk insert NULLs the missing not-null column");
    const w = ok(
      await sb
        .from("workspaces")
        .insert(
          [
            { id: W.company, name: "OpenSign 워크스페이스", owner_id: U.admin },
            { id: W.personal, name: "관리자", type: "personal", owner_id: U.admin },
            { id: W.other, name: "다른 회사", owner_id: U.outsider },
          ],
          { defaultToNull: false },
        )
        .select(),
      "insert workspaces (defaultToNull: false → column defaults)",
    );
    const ws = w.data as Row[];
    assertEq([ws[0].type, ws[1].type], ["team", "personal"], "enum default with missing=default");
    assertEq(ws[0].settings, {}, "'{}'::jsonb default");
    const m = await sb.from("workspace_members").insert([
      { workspace_id: W.company, user_id: U.admin, role: "owner", is_default: true },
      { workspace_id: W.company, user_id: U.seoyeon, role: "admin", is_default: true },
      { workspace_id: W.other, user_id: U.outsider, role: "owner", is_default: true },
    ]);
    ok(m, "insert members");
    await insertEach("workspace_members", [
      { workspace_id: W.company, user_id: U.minsu, is_default: true },
      { workspace_id: W.personal, user_id: U.admin, role: "owner" },
    ]);
    assertEq(m.data, null, "insert without select → data null");
    assertEq(m.status, 201, "status 201");
    assertEq(db.rows("workspace_members").find((x) => x.user_id === U.minsu)?.role, "member", "member_role default");
    assertEq(db.rows("workspace_members").find((x) => x.user_id === U.admin && x.workspace_id === W.personal)?.is_default, false, "boolean default false");
  });

  const L = { a: uuid(), b: uuid() };
  await test("insert templates/labels/documents/participants/fields/events", async () => {
    await insertEach("labels", [{ id: L.a, workspace_id: W.company, name: "계약" }, { id: L.b, workspace_id: W.company, name: "인사", color: "#ff0000" }]);
    await insertEach("templates", [
      { id: T.tpl1, workspace_id: W.company, owner_id: U.admin, title: "근로계약서", file_path: `${W.company}/templates/${T.tpl1}.pdf`, roles: [{ key: "r1", name: "근로자", color_index: 0 }], label_ids: [L.a] },
      { id: T.tpl2, workspace_id: W.company, owner_id: U.minsu, title: "비밀유지서약서", shared: true },
    ]);
    const tpl = db.rows("templates").find((t) => t.id === T.tpl2)!;
    assertEq([tpl.label_ids, tpl.page_sizes, tpl.fields, tpl.pinned, tpl.request_type, tpl.signing_order, tpl.page_count], [[], [], [], false, "sign", "sequential", 1], "template defaults");
    const now = Date.now();
    const iso = (d: number) => new Date(now + d * 86_400_000).toISOString();
    await insertEach("documents", [
        { id: D.draft, workspace_id: W.company, owner_id: U.minsu, title: "초안 문서", file_path: `${W.company}/documents/${D.draft}/original.pdf`, created_at: iso(-5), last_activity_at: iso(-5) },
        { id: D.sent, workspace_id: W.company, owner_id: U.admin, title: "근로계약서 - 김민수", status: "in_progress", template_id: T.tpl1, requested_at: iso(-2), label_ids: [L.a, L.b], created_at: iso(-3), last_activity_at: iso(-1) },
        { id: D.done, workspace_id: W.company, owner_id: U.admin, title: "완료된 계약", status: "completed", requested_at: iso(-10), completed_at: iso(-9), label_ids: [L.b], created_at: iso(-11), last_activity_at: iso(-9) },
        { id: D.scheduled, workspace_id: W.company, owner_id: U.seoyeon, title: "예약 문서 50%_off", status: "scheduled", scheduled_at: iso(-0.1), created_at: iso(-1), last_activity_at: iso(-1) },
        { id: D.otherWs, workspace_id: W.other, owner_id: U.outsider, title: "다른 회사 문서", status: "in_progress", requested_at: iso(-1) },
    ]);
    const d = db.rows("documents").find((x) => x.id === D.draft)!;
    assertEq([d.status, d.expires_days, d.hidden, d.attachments, d.cc, d.label_ids], ["draft", 14, false, [], [], []], "document defaults");
    await insertEach("participants", [
        { document_id: D.sent, order_index: 0, name: "김민수", email: "minsu@example.test", status: "pending", expires_at: iso(-0.5), delivery: "email" },
        { document_id: D.sent, order_index: 1, name: "외부 서명자", email: "Signer@Example.test", status: "waiting", delivery: "email" },
        { document_id: D.done, order_index: 0, name: "이서연", email: "seoyeon@example.test", status: "signed", signed_at: iso(-9) },
        { document_id: D.draft, order_index: 0, name: "", email: null },
        { document_id: D.otherWs, order_index: 0, name: "누군가", email: "x@example.test", status: "pending", expires_at: iso(-1) },
    ]);
    const p = db.rows("participants").find((x) => x.document_id === D.draft)!;
    assert(typeof p.access_token === "string" && (p.access_token as string).length === 36, "access_token default uuid");
    assertEq([p.role, p.locale, p.request_attachment, p.draft_values], ["signer", "ko", false, {}], "participant defaults");
    const signer = db.rows("participants").find((x) => x.document_id === D.sent && x.order_index === 0)!;
    await insertEach("fields", [
      { document_id: D.sent, participant_id: signer.id, type: "signature", x: 10, y: 20, width: 100, height: 40 },
      { document_id: D.sent, participant_id: signer.id, type: "text", page: 2, x: "1.5", y: 2, width: 3, height: 4, options: { autoFill: "name" } },
    ]);
    const f = db.rows("fields").find((x) => x.type === "text")!;
    assertEq([f.x, f.required, f.page], [1.5, true, 2], "double precision coercion + defaults");
    await insertEach("document_events", [{ document_id: D.sent, type: "created" }, { document_id: D.sent, type: "sent", meta: { auto: false } }, { document_id: D.sent, type: "reminded" }]);
  });

  // ------------------------------------------------------------------ every select string of the app
  await test("every .from(table).select(...) string in src/ parses and resolves against the schema", async () => {
    const found = scanAppSelects();
    assert(found.length > 100, `scanned ${found.length} selects`);
    const bad: string[] = [];
    for (const f of found) {
      try {
        buildPlan(schema, f.table, parseSelect(f.select));
        const r = await sb.from(f.table).select(f.select).limit(5);
        if (r.error) bad.push(`${f.file}: ${f.table} "${f.select}" → ${r.error.code} ${r.error.message}`);
      } catch (e) {
        bad.push(`${f.file}: ${f.table} "${f.select}" → ${(e as Error).message}`);
      }
    }
    assert(!bad.length, `unresolved selects:\n      ${bad.join("\n      ")}`);
    if (VERBOSE) console.log(`       (${found.length} select strings checked)`);
  });

  // ------------------------------------------------------------------ embeds
  await test("embed one-to-many + many-to-one, aliases, FK hint (real select strings)", async () => {
    const PARTICIPANT_COLUMNS = "id, order_index, role, name, email, status, delivery, sent_at, viewed_at, signed_at, expires_at, reject_reason";
    const r = ok(
      await sb
        .from("documents")
        .select(`id, title, status, request_type, signing_order, requested_at, completed_at, owner_id, participants(${PARTICIPANT_COLUMNS})`)
        .eq("id", D.sent)
        .eq("workspace_id", W.company)
        .maybeSingle(),
      "document with participants",
    );
    const doc = r.data as Row & { participants: Row[] };
    assert(Array.isArray(doc.participants) && doc.participants.length === 2, "o2m → array");
    assertEq(Object.keys(doc.participants[0]), PARTICIPANT_COLUMNS.split(", "), "embedded column order");
    assert(!("access_token" in doc.participants[0]), "only selected columns");
    const lone = ok(await sb.from("documents").select("id, participants(id)").eq("id", D.scheduled).single(), "no participants");
    assertEq((lone.data as Row).participants, [], "o2m without rows → []");

    const ap = ok(
      await sb.from("approvals").insert({ id: uuid(), workspace_id: W.company, drafter_id: U.minsu, title: "기안 1" }).select("*, drafter:profiles!approvals_drafter_id_fkey(id, name, email)").single(),
      "approval insert + embed",
    );
    assertEq((ap.data as Row).drafter, { id: U.minsu, name: "김민수", email: "minsu@example.test" }, "m2o alias + !fkey hint");
    assert((ap.data as Row).status === "pending" && Array.isArray((ap.data as Row).approvers), "approval defaults");

    const draftId = ok(await sb.from("drafts").insert({ workspace_id: W.company, owner_id: U.seoyeon }).select("id").single(), "draft").data as Row;
    const dr = ok(await sb.from("drafts").select("id, owner_id, title, created_at, updated_at, owner:profiles(name)").eq("id", draftId.id).single(), "drafts owner embed");
    assertEq([(dr.data as Row).title, (dr.data as Row).owner], ["제목 없는 서식", { name: "이서연" }], "korean default + alias:profiles(name)");

    const mem = ok(await sb.from("workspace_members").select("role, is_default, workspaces(id, name, type, created_at)").eq("user_id", U.admin), "session.ts workspaces embed");
    const list = mem.data as (Row & { workspaces: Row })[];
    assertEq(list.length, 2, "two memberships");
    assert(list.every((x) => x.workspaces && typeof x.workspaces === "object" && !Array.isArray(x.workspaces)), "m2o → object");

    const prof = ok(await sb.from("workspace_members").select("user_id, profiles(id, name, email, department, position)").eq("workspace_id", W.company), "members + profiles");
    assertEq(((prof.data as Row[]).find((x) => x.user_id === U.minsu)!.profiles as Row).department, "영업", "profiles embed values");

    const settingsRole = ok(await sb.from("workspace_members").select("role, workspaces(type, owner_id)").eq("workspace_id", W.company).eq("user_id", U.seoyeon).maybeSingle(), "role + workspace");
    assertEq(settingsRole.data, { role: "admin", workspaces: { type: "team", owner_id: U.admin } }, "settings/_lib/server.ts shape");

    const nested = ok(await sb.from("documents").select("id, participants(id, fields(type))").eq("id", D.sent).single(), "nested embed");
    const ps = (nested.data as Row).participants as Row[];
    assertEq(ps.map((p) => (p.fields as Row[]).length).sort(), [0, 2], "nested o2m via fields.participant_id");

    const one = ok(await sb.from("participants").select("id, participant_identity_attempts(failures)").eq("document_id", D.draft).single(), "o2o");
    assertEq((one.data as Row).participant_identity_attempts, null, "one-to-one (unique FK) → object|null");

    const tm = ok(await sb.from("templates").select("id, documents(id)").eq("id", T.tpl1).single(), "templates → documents");
    assertEq(((tm.data as Row).documents as Row[]).map((x) => x.id), [D.sent], "o2m via template_id");

    const fkcol = ok(await sb.from("documents").select("id, owner_id(name)").eq("id", D.sent).single(), "embed by FK column");
    assertEq((fkcol.data as Row).owner_id, { name: "관리자" }, "owner_id(name)");

    const amb = await sb.from("templates").select("id, profiles(name)").eq("id", T.tpl1);
    errCode(amb, "PGRST201", "templates→profiles is ambiguous (owner_id, last_modified_by)");
    const hinted = ok(await sb.from("templates").select("id, owner:profiles!owner_id(name), editor:profiles!templates_last_modified_by_fkey(name)").eq("id", T.tpl1).single(), "hint by column / by fk name");
    assertEq([(hinted.data as Row).owner, (hinted.data as Row).editor], [{ name: "관리자" }, null], "hints resolve; null FK → null");
    errCode(await sb.from("labels").select("id, contacts(id)"), "PGRST200", "no relationship");
    errCode(await sb.from("labels").select("id, nope"), "42703", "unknown column");
    errCode(await sb.from("nope_table").select("*"), "42P01", "unknown table");

    const spread = ok(await sb.from("participants").select("id, ...documents(doc_title:title)").eq("document_id", D.done).single(), "spread");
    assertEq((spread.data as Row).doc_title, "완료된 계약", "...rel() spread");

    const cnt = ok(await sb.from("documents").select("id, participants(count)").eq("id", D.sent).single(), "rel(count)");
    assertEq((cnt.data as Row).participants, [{ count: 2 }], "embedded count aggregate");

    const json = ok(await sb.from("document_events").select("id, auto:meta->auto, autoText:meta->>auto").eq("type", "sent").single(), "json path");
    assertEq([(json.data as Row).auto, (json.data as Row).autoText], [false, "false"], "-> / ->>");
  });

  await test("!inner + filters on embedded columns (expireOverdue / members actions)", async () => {
    const nowIso = new Date().toISOString();
    const r = ok(
      await sb
        .from("participants")
        .select("document_id, name, email, documents!inner(id, workspace_id, status, owner_id, title)")
        .eq("status", "pending")
        .lt("expires_at", nowIso)
        .eq("documents.workspace_id", W.company)
        .eq("documents.status", "in_progress")
        .limit(100),
      "send.ts expireOverdue query",
    );
    const rows = r.data as (Row & { documents: Row })[];
    assertEq(rows.map((x) => x.document_id), [D.sent], "only the company's in-progress doc (other workspace dropped by !inner)");
    assertEq(rows[0].documents.title, "근로계약서 - 김민수", "embedded object");
    // without !inner the parent stays and the embed becomes null
    const loose = ok(await sb.from("participants").select("document_id, documents(id)").eq("status", "pending").eq("documents.workspace_id", W.company), "left embed");
    assertEq((loose.data as Row[]).length, 2, "both pending participants kept");
    assert((loose.data as Row[]).some((x) => x.documents === null), "filtered-out m2o embed → null");
    const m = ok(await sb.from("workspace_members").select("workspace_id, workspaces!inner(type)").eq("user_id", U.admin).neq("workspace_id", W.company), "members actions");
    assertEq(m.data, [{ workspace_id: W.personal, workspaces: { type: "personal" } }], "!inner(type) + neq");
    const inner2 = ok(await sb.from("documents").select("id, participants!inner(email)").eq("participants.status", "signed"), "o2m inner");
    assertEq((inner2.data as Row[]).map((x) => x.id), [D.done], "o2m !inner keeps parents with matching children only");
    const notNull = ok(await sb.from("documents").select("id, participants(id)").not("participants", "is", null).eq("workspace_id", W.company), "rel=not.is.null");
    assertEq((notNull.data as Row[]).length, 3, "documents with participants (draft, sent, done)");
    errCode(await sb.from("participants").select("id").eq("documents.status", "x"), "PGRST108", "filter on a non-embedded resource");
  });

  // ------------------------------------------------------------------ filters
  await test("or() with quoted values, not(), in, contains, ilike (escapes), is", async () => {
    const fromIso = new Date(Date.now() - 4 * 86_400_000).toISOString();
    const home = ok(
      await sb
        .from("documents")
        .select("id, owner_id, status, request_type, created_at, requested_at, participants(email, status)")
        .eq("workspace_id", W.company)
        .eq("hidden", false)
        .or(`requested_at.gte."${fromIso}",status.eq.scheduled`)
        .order("created_at", { ascending: false })
        .range(0, 199),
      "home page query",
    );
    assertEq((home.data as Row[]).map((x) => x.id), [D.scheduled, D.sent], "or(gte quoted, eq) ordered by created_at desc");
    const sig = ok(await sb.from("labels").select("id").or(`workspace_id.eq.${W.company},workspace_id.is.null`), "or eq/is.null");
    assertEq((sig.data as Row[]).length, 2, "labels via or()");
    const nested = ok(await sb.from("documents").select("id").or(`and(status.eq.completed,hidden.is.false),title.ilike.*예약*`), "nested and() + ilike *");
    assertEq((nested.data as Row[]).map((x) => x.id).sort(), [D.done, D.scheduled].sort(), "logic tree");
    const notOr = ok(await sb.from("documents").select("id").eq("workspace_id", W.company).not("status", "in", "(draft,completed)"), "not.in");
    assertEq((notOr.data as Row[]).map((x) => x.id).sort(), [D.sent, D.scheduled].sort(), "not in");
    const tpl = ok(await sb.from("templates").select("id").eq("workspace_id", W.company).not("file_path", "is", null), "not is null");
    assertEq((tpl.data as Row[]).map((x) => x.id), [T.tpl1], "templates with files");
    const lab = ok(await sb.from("documents").select("id").contains("label_ids", [L.b]).order("created_at"), "contains uuid[]");
    assertEq((lab.data as Row[]).map((x) => x.id), [D.done, D.sent], "label filter");
    const ov = ok(await sb.from("documents").select("id").overlaps("label_ids", [L.a, uuid()]), "overlaps");
    assertEq((ov.data as Row[]).map((x) => x.id), [D.sent], "ov");
    const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
    const esc = ok(await sb.from("documents").select("id").ilike("title", `%${escapeLike("50%_OFF")}%`), "ilike escaped");
    assertEq((esc.data as Row[]).map((x) => x.id), [D.scheduled], "escaped % and _ match literally, case-insensitive");
    const esc2 = ok(await sb.from("documents").select("id").ilike("title", `%${escapeLike("50x_off")}%`), "ilike escaped (no match)");
    assertEq(esc2.data, [], "escaped _ is not a wildcard");
    const inIds = ok(await sb.from("documents").select("id").in("id", [D.done, D.draft, D.done]), "in");
    assertEq((inIds.data as Row[]).length, 2, "in() de-duplicates");
    const empty = ok(await sb.from("documents").select("id").in("id", []), "in empty");
    assertEq(empty.data, [], "in.() → no rows");
    const isNull = ok(await sb.from("participants").select("id").eq("document_id", D.sent).is("viewed_at", null), "is null");
    assertEq((isNull.data as Row[]).length, 2, "is.null");
    // NULL semantics: neq drops NULL rows
    const neq = ok(await sb.from("participants").select("id").neq("email", "minsu@example.test"), "neq");
    assertEq((neq.data as Row[]).length, 3, "neq excludes NULL emails (3 of 4 non-null others)");
    const notEq = ok(await sb.from("participants").select("id").not("email", "eq", "minsu@example.test"), "not.eq");
    assertEq((notEq.data as Row[]).length, 3, "NOT(NULL = x) is unknown → dropped");
    const enumOrder = ok(await sb.from("documents").select("status").eq("workspace_id", W.company).order("status"), "enum order");
    assertEq((enumOrder.data as Row[]).map((x) => x.status), ["draft", "scheduled", "in_progress", "completed"], "enums sort by declaration order");
    const mail = ok(await sb.from("participants").select("id").or(`email.ilike.%signer@%,name.ilike.%없는%`), "mailbox-style ilike or");
    assertEq((mail.data as Row[]).length, 1, "ilike % inside or() (case-insensitive)");
    const ts = ok(await sb.from("documents").select("id").eq("workspace_id", W.company).eq("status", "scheduled").lte("scheduled_at", new Date().toISOString()).order("scheduled_at").limit(50), "dispatchScheduled");
    assertEq((ts.data as Row[]).map((x) => x.id), [D.scheduled], "timestamptz comparison");
    const filt = ok(await sb.from("documents").select("id").filter("status", "in", "(completed)"), "filter()");
    assertEq((filt.data as Row[]).map((x) => x.id), [D.done], "raw filter()");
    const matchQ = ok(await sb.from("documents").select("id").match({ workspace_id: W.company, status: "draft" }), "match()");
    assertEq((matchQ.data as Row[]).map((x) => x.id), [D.draft], "match()");
    errCode(await sb.from("documents").select("id").eq("id", "not-a-uuid"), "22P02", "invalid uuid literal");
    errCode(await sb.from("documents").select("id").eq("status", "bogus"), "22P02", "invalid enum literal");
    errCode(await sb.from("documents").select("id").eq("nope", 1), "42703", "unknown filter column");
    errCode(await sb.from("documents").select("id").eq("hidden", "maybe"), "22P02", "invalid boolean");
  });

  await test("order (multi, nullsFirst, referencedTable), limit, range, count + head", async () => {
    const r = ok(
      await sb
        .from("documents")
        .select("id, completed_at, participants(order_index, name)")
        .eq("workspace_id", W.company)
        .order("completed_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .order("order_index", { referencedTable: "participants", ascending: false })
        .limit(3),
      "order",
    );
    const rows = r.data as (Row & { participants: Row[] })[];
    assertEq(rows[0].id, D.done, "desc + nullslast puts the non-null first");
    assertEq(rows.length, 3, "limit");
    const sent = rows.find((x) => x.id === D.sent)!;
    assertEq(sent.participants.map((p) => p.order_index), [1, 0], "referencedTable order");
    const dflt = ok(await sb.from("documents").select("id").eq("workspace_id", W.company).order("completed_at", { ascending: false }), "desc default nulls first");
    assert((dflt.data as Row[])[0].id !== D.done, "DESC defaults to NULLS FIRST");
    const lim = ok(await sb.from("documents").select("id, participants(id)").eq("id", D.sent).limit(1, { referencedTable: "participants" }).single(), "embedded limit");
    assertEq(((lim.data as Row).participants as Row[]).length, 1, "participants.limit");
    const page = ok(await sb.from("documents").select("id", { count: "exact" }).eq("workspace_id", W.company).order("created_at").range(1, 2), "range + count");
    assertEq([(page.data as Row[]).length, page.count, page.status], [2, 4, 206], "range(1,2) of 4, count exact, 206");
    const head = ok(await sb.from("participants").select("id", { count: "exact", head: true }).eq("document_id", D.sent), "head count");
    assertEq([head.data, head.count, head.status], [null, 2, 200], "head → data null, count");
    const pins = ok(await sb.from("template_pins").select("template_id", { count: "exact", head: true }).eq("user_id", U.admin), "count 0");
    assertEq(pins.count, 0, "count 0");
    const sigs = ok(await sb.from("signatures").select("id, kind, image_data, created_at, is_default").eq("user_id", U.admin).order("is_default", { ascending: false }).order("created_at", { ascending: false }).limit(24), "empty list");
    assertEq(sigs.data, [], "empty array, not null");
  });

  await test("single / maybeSingle semantics", async () => {
    const none = await sb.from("documents").select("id").eq("id", uuid()).single();
    errCode(none, "PGRST116", "single() with 0 rows");
    assertEq([none.error?.message, none.error?.details, none.status], ["JSON object requested, multiple (or no) rows returned", "The result contains 0 rows", 406], "PGRST116 shape");
    errCode(await sb.from("documents").select("id").eq("workspace_id", W.company).single(), "PGRST116", "single() with many rows");
    const maybe = ok(await sb.from("documents").select("id").eq("id", uuid()).maybeSingle(), "maybeSingle 0");
    assertEq([maybe.data, maybe.status], [null, 200], "maybeSingle 0 → null");
    errCode(await sb.from("documents").select("id").eq("workspace_id", W.company).maybeSingle(), "PGRST116", "maybeSingle >1");
    const one = ok(await sb.from("workspaces").select("id").eq("type", "team").order("created_at", { ascending: true }).limit(1).maybeSingle(), "limit(1).maybeSingle()");
    assert(one.data && typeof one.data === "object" && !Array.isArray(one.data), "object");
  });

  // ------------------------------------------------------------------ mutations
  await test("unique violations (23505) incl. expression indexes, NOT NULL, FK, CHECK, enum/uuid input", async () => {
    errCode(await sb.from("profiles").insert({ id: uuid(), email: "x@example.test", username: "minsu", name: "dup" }), "23505", "profiles.username unique");
    const cf1 = ok(await sb.from("custom_fields").insert({ workspace_id: W.company, owner_id: U.admin, name: "사번" }).select("id").single(), "custom field");
    assert((cf1.data as Row).id, "id returned");
    const dup = await sb.from("custom_fields").insert({ workspace_id: W.company, owner_id: U.admin, name: "사번" });
    errCode(dup, "23505", "custom_fields (workspace_id, lower(name))");
    assert(dup.error!.message.includes("custom_fields_name_uniq") && dup.status === 409, "constraint name + 409");
    ok(await sb.from("custom_fields").insert({ workspace_id: W.other, owner_id: U.outsider, name: "사번" }), "same name, other workspace");
    ok(await sb.from("custom_fields").insert({ workspace_id: W.company, owner_id: U.admin, name: "Code" }), "Code");
    errCode(await sb.from("custom_fields").insert({ workspace_id: W.company, owner_id: U.admin, name: "code" }), "23505", "lower() makes it case-insensitive");
    ok(await sb.from("groups").insert({ workspace_id: W.company, name: "영업팀" }), "group");
    errCode(await sb.from("groups").insert({ workspace_id: W.company, name: "영업팀 " }), "23505", "lower(btrim(name)) trims");
    errCode(await sb.from("groups").insert({ workspace_id: W.company, name: "   " }), "23514", "groups name check (char_length(btrim) between 1 and 30)");
    errCode(await sb.from("documents").insert({ workspace_id: W.company, owner_id: U.admin }), "23502", "documents.title not null");
    errCode(await sb.from("participants").insert({ document_id: uuid(), name: "x" }), "23503", "FK target missing");
    errCode(await sb.from("contacts").insert({ workspace_id: W.company, owner_id: U.admin, name: "연락처" }), "23514", "contacts_has_channel");
    errCode(await sb.from("contacts").insert({ workspace_id: W.company, owner_id: U.admin, name: "연락처", email: "c@example.test", default_channel: "fax" }), "23514", "contacts_default_channel");
    ok(await sb.from("contacts").insert({ workspace_id: W.company, owner_id: U.admin, name: "연락처", email: "c@example.test" }), "valid contact");
    const did = uuid();
    errCode(await sb.from("documents").insert({ id: did, workspace_id: W.company, owner_id: U.admin, title: "x", file_path: `${W.company}/documents/${uuid()}/original.pdf` }), "23514", "canonical file_path check");
    ok(await sb.from("documents").insert({ id: did, workspace_id: W.company, owner_id: U.admin, title: "x", file_path: `${W.company}/documents/${did}/original.pdf` }), "canonical path ok");
    errCode(await sb.from("signatures").insert({ user_id: U.admin, kind: "sign", image_data: "data:,", shared: true, workspace_id: W.company }), "23514", "signatures_shared_stamp_only");
    errCode(await sb.from("documents").insert({ workspace_id: W.company, owner_id: U.admin, title: "x", status: "nope" }), "22P02", "invalid enum value");
    errCode(await sb.from("documents").insert({ workspace_id: "bad", owner_id: U.admin, title: "x" }), "22P02", "invalid uuid");
    errCode(await sb.from("documents").insert({ workspace_id: W.company, owner_id: U.admin, title: "x", page_count: 1.5 }), "22P02", "integer");
    errCode(await sb.from("documents").insert({ workspace_id: W.company, owner_id: U.admin, title: "x", nope: 1 }), "PGRST204", "unknown column");
    // statement atomicity: the 2nd row fails → the 1st is not kept
    const before = db.rows("labels").length;
    errCode(await sb.from("labels").insert([{ workspace_id: W.company, name: "ok" }, { workspace_id: W.company }]), "23502", "bulk insert, 2nd row bad");
    assertEq(db.rows("labels").length, before, "bulk insert is all-or-nothing");
  });

  await test("upsert: onConflict + ignoreDuplicates, merge-duplicates, 42P10", async () => {
    const pin = { template_id: T.tpl1, user_id: U.admin };
    const r1 = ok(await sb.from("template_pins").upsert(pin, { onConflict: "template_id,user_id", ignoreDuplicates: true }).select(), "pin");
    assertEq((r1.data as Row[]).length, 1, "inserted");
    const r2 = ok(await sb.from("template_pins").upsert(pin, { onConflict: "template_id,user_id", ignoreDuplicates: true }).select(), "pin again");
    assertEq(r2.data, [], "ignored duplicate returns nothing");
    assertEq(db.rows("template_pins").length, 1, "still one pin");
    const m = ok(await sb.from("workspace_members").upsert({ workspace_id: W.company, user_id: U.minsu, role: "admin", is_default: true }, { onConflict: "workspace_id,user_id" }).select("role, joined_at"), "merge");
    assertEq((m.data as Row[])[0].role, "admin", "merged update");
    assertEq(db.rows("workspace_members").filter((x) => x.workspace_id === W.company).length, 3, "no duplicate member");
    const newUser = uuid();
    ok(await sb.from("profiles").insert({ id: newUser, email: "new@example.test", name: "신규" }), "profile");
    ok(await sb.from("workspace_members").upsert({ workspace_id: W.company, user_id: newUser, role: "member", is_default: true }, { onConflict: "workspace_id,user_id" }), "upsert insert path");
    assertEq(db.rows("workspace_members").filter((x) => x.workspace_id === W.company).length, 4, "inserted");
    errCode(await sb.from("labels").upsert({ workspace_id: W.company, name: "x" }, { onConflict: "name" }), "42P10", "no matching unique constraint");
    const pk = ok(await sb.from("labels").upsert({ id: L.a, workspace_id: W.company, name: "계약(수정)" }).select("name, color"), "PK upsert");
    assertEq((pk.data as Row[])[0], { name: "계약(수정)", color: "#5991f4" }, "default conflict target = PK; untouched columns kept");
    ok(await sb.from("workspace_members").update({ role: "member" }).eq("workspace_id", W.company).eq("user_id", U.minsu), "restore role");
  });

  await test("update/delete: returning only with .select(), filters, 204, safe-update 21000", async () => {
    const u0 = ok(await sb.from("documents").update({ hidden: true }).eq("id", D.done), "update no select");
    assertEq([u0.data, u0.status], [null, 204], "update without select → null/204");
    const u1 = ok(await sb.from("documents").update({ status: "scheduled", scheduled_at: "2030-01-01T09:00:00+09:00" }).eq("id", D.draft).in("status", ["draft", "on_modifying"]).select("id, scheduled_at"), "update + select");
    assertEq(u1.data, [{ id: D.draft, scheduled_at: "2030-01-01T00:00:00.000Z" }], "returning + timestamptz normalised to UTC ISO");
    assertEq(u1.status, 200, "200 with representation");
    const u2 = ok(await sb.from("documents").update({ status: "draft" }).eq("id", D.draft).eq("status", "in_progress").select("id"), "guarded update");
    assertEq(u2.data, [], "no rows matched → []");
    ok(await sb.from("documents").update({ status: "draft", scheduled_at: null }).eq("id", D.draft), "revert");
    const staleBefore = new Date(Date.now() - 5 * 60_000).toISOString();
    ok(await sb.from("documents").update({ completed_file_path: null }).eq("id", D.done), "prep");
    const claim = ok(
      await sb
        .from("documents")
        .update({ finalizing_at: new Date().toISOString() })
        .eq("id", D.done)
        .eq("status", "completed")
        .is("completed_file_path", null)
        .or(`finalizing_at.is.null,finalizing_at.lt."${staleBefore}"`)
        .select("id"),
      "finalize claim",
    );
    assertEq(claim.data, [{ id: D.done }], "claimed once");
    const again = ok(await sb.from("documents").update({ finalizing_at: new Date().toISOString() }).eq("id", D.done).is("completed_file_path", null).or(`finalizing_at.is.null,finalizing_at.lt."${staleBefore}"`).select("id"), "second claim");
    assertEq(again.data, [], "single-flight claim");
    const cnt = ok(await sb.from("document_events").update({ ip: "127.0.0.1" }, { count: "exact" }).eq("document_id", D.sent), "update count");
    assertEq(cnt.count, 3, "update count exact");
    errCode(await sb.from("documents").update({ hidden: false }), "21000", "UPDATE requires a WHERE clause");
    errCode(await sb.from("documents").delete(), "21000", "DELETE requires a WHERE clause");
    errCode(await sb.from("documents").update({ title: null }).eq("id", D.done), "23502", "update to null on not-null");
    const del = ok(await sb.from("contacts").delete().eq("workspace_id", W.company).in("id", db.rows("contacts").map((c) => c.id as string)).select("id"), "delete + select");
    assertEq((del.data as Row[]).length, 1, "deleted rows returned");
    const del0 = ok(await sb.from("contacts").delete().eq("id", uuid()), "delete nothing");
    assertEq([del0.data, del0.status], [null, 204], "delete without select → null/204");
    const sel = ok(await sb.from("labels").insert({ workspace_id: W.company, name: "신규 라벨", color: "#123456" }).select("*").single(), "labels insert select * single");
    assertEq(Object.keys(sel.data as Row), ["id", "workspace_id", "name", "color", "created_at"], "select * column order");
    const ro = ok(await sb.from("labels").insert({ workspace_id: W.company, name: "롤백" }).select("id").rollback(), "rollback()");
    assert((ro.data as Row[]).length === 1 && !db.rows("labels").some((l) => l.name === "롤백"), "Prefer: tx=rollback undoes the insert");
    errCode(await sb.from("labels").insert([{ workspace_id: W.company, name: "a1" }, { workspace_id: W.company, name: "a2" }]).select("id").single(), "PGRST116", "insert 2 rows + single()");
    assert(!db.rows("labels").some((l) => l.name === "a1"), "PGRST116 on a mutation rolls it back");
  });

  await test("cascades, set null, triggers (prune group members, custom_fields_limit)", async () => {
    // FK on delete cascade: document → participants, fields, events
    const pBefore = db.rows("participants").filter((p) => p.document_id === D.sent).length;
    assert(pBefore === 2 && db.rows("fields").some((f) => f.document_id === D.sent), "fixture");
    // FK on delete set null: template → documents.template_id
    ok(await sb.from("templates").delete().eq("id", T.tpl1), "delete template");
    assertEq(db.rows("documents").find((d) => d.id === D.sent)?.template_id, null, "documents.template_id set null");
    assert(!db.rows("template_pins").some((p) => p.template_id === T.tpl1), "template_pins cascade");
    const delDoc = ok(await sb.from("documents").delete().eq("id", D.sent).select("id"), "delete document");
    assertEq((delDoc.data as Row[]).length, 1, "returned");
    assert(!db.rows("participants").some((p) => p.document_id === D.sent), "participants cascaded");
    assert(!db.rows("fields").some((f) => f.document_id === D.sent), "fields cascaded");
    assert(!db.rows("document_events").some((e) => e.document_id === D.sent), "events cascaded");
    // trigger: leaving a workspace removes the user from its groups
    const g = db.rows("groups").find((x) => x.name === "영업팀")!;
    ok(await sb.from("group_members").insert([{ group_id: g.id, user_id: U.minsu }, { group_id: g.id, user_id: U.seoyeon }]), "group members");
    const left = ok(await sb.from("workspace_members").delete().eq("workspace_id", W.company).eq("user_id", U.minsu).select("user_id"), "remove member");
    assertEq(left.data, [{ user_id: U.minsu }], "delete returning");
    assertEq(db.rows("group_members").map((x) => x.user_id), [U.seoyeon], "workspace_members_prune_groups trigger");
    // trigger: 30 custom fields per workspace
    const have = db.rows("custom_fields").filter((x) => x.workspace_id === W.company).length;
    for (let i = have; i < 30; i++) ok(await sb.from("custom_fields").insert({ workspace_id: W.company, owner_id: U.admin, name: `field ${i}` }), `cf ${i}`);
    const over = await sb.from("custom_fields").insert({ workspace_id: W.company, owner_id: U.admin, name: "field 31" });
    errCode(over, "P0001", "custom_fields_limit");
    assertEq(over.error?.message, "custom_fields_limit", "trigger message");
    // deleting a profile cascades everything it owns; set null where declared
    const ev = ok(await sb.from("approval_events").insert({ approval_id: db.rows("approvals")[0].id, type: "submitted", actor_id: U.seoyeon }).select("id").single(), "approval event");
    ok(await sb.from("profiles").delete().eq("id", U.seoyeon), "delete profile");
    assert(!db.rows("documents").some((d) => d.owner_id === U.seoyeon), "documents of the profile cascaded");
    assert(!db.rows("workspace_members").some((m) => m.user_id === U.seoyeon), "memberships cascaded");
    assertEq(db.rows("approval_events").find((e) => e.id === (ev.data as Row).id)?.actor_id, null, "approval_events.actor_id set null");
    // runtime trigger registration
    registerTrigger({ name: "test_upper_label", table: "labels", timing: "before", events: ["insert"], fn: ({ new: row }) => (row && row.name === "lower" ? { ...row, name: "LOWER" } : undefined) }, db);
    const tr = ok(await sb.from("labels").insert({ workspace_id: W.company, name: "lower" }).select("name").single(), "trigger insert");
    assertEq((tr.data as Row).name, "LOWER", "before-insert trigger may replace NEW");
    db.state.triggers.delete("test_upper_label");
  });

  await test("sequences (bigserial), jsonb/array round trip, deep copies", async () => {
    const link = ok(await sb.from("link_signs").insert({ workspace_id: W.company, owner_id: U.admin, title: "링크" }).select("id, token, active, label_ids").single(), "link sign");
    const l = link.data as Row;
    assertEq([l.active, l.label_ids], [true, []], "defaults");
    const a = ok(await sb.from("link_sign_attempts").insert([{ link_id: l.id, email_norm: "a" }, { link_id: l.id, email_norm: "b" }]).select("id"), "attempts");
    assertEq((a.data as Row[]).map((x) => x.id), [1, 2], "bigserial ids");
    const r = ok(await sb.from("link_signs").select("*").eq("id", l.id as string).single(), "read");
    (r.data as Row).title = "mutated";
    ((r.data as Row).label_ids as unknown[]).push("x");
    const again = ok(await sb.from("link_signs").select("title, label_ids").eq("id", l.id as string).single(), "re-read");
    assertEq(again.data, { title: "링크", label_ids: [] }, "results are deep copies");
    const pv = { a: [1, { b: true }] };
    const ins = ok(await sb.from("drafts").insert({ workspace_id: W.company, owner_id: U.admin, title: "j" }).select("id").single(), "draft");
    ok(await sb.from("participant_identity_attempts").select("*").limit(1), "empty table read");
    const ed = ok(await sb.from("editing_documents").insert({ workspace_id: W.company, owner_id: U.admin, title: "e", annotations: [pv] }).select("annotations").single(), "jsonb insert");
    pv.a.push(2);
    assertEq((ed.data as Row).annotations, [{ a: [1, { b: true }] }], "stored value is a copy of the input");
    assert((ins.data as Row).id, "ok");
    const inf = ok(await sb.from("participant_identity_attempts").insert({ participant_id: db.rows("participants")[0].id, locked_until: "infinity" }).select("locked_until").single(), "infinity");
    assertEq((inf.data as Row).locked_until, "infinity", "'infinity' timestamptz kept");
    const later = ok(await sb.from("participant_identity_attempts").select("participant_id").gt("locked_until", "2999-01-01T00:00:00Z"), "infinity compare");
    assertEq((later.data as Row[]).length, 1, "infinity > any timestamp");
  });

  // ------------------------------------------------------------------ RPC
  await test("RPC dispatch: rows + chained filters, scalar, void, unknown fn, rollback on error", async () => {
    const rows = ok(await sb.rpc("echo_rows", { extra: "z" }).gte("n", 2).order("name").select("id, name"), "set-returning + filters");
    assertEq(rows.data, [{ id: 1, name: "b" }, { id: 3, name: "z" }], "filters/order/select applied to rpc rows");
    const all = ok(await sb.rpc("echo_rows"), "verbatim");
    assertEq((all.data as Row[]).length, 3, "no chain → verbatim");
    const single = ok(await sb.rpc("echo_rows").eq("id", 2).single(), "single on rpc");
    assertEq(single.data, { id: 2, name: "a", n: 1 }, "single row");
    const cnt = ok(await sb.rpc("echo_rows", {}, { count: "exact", head: true }), "head count");
    assertEq([cnt.data, cnt.count], [null, 3], "rpc head/count");
    const sc = ok(await sb.rpc("scalar_fn", { who: "world" }), "scalar");
    assertEq(sc.data, "hello world", "scalar");
    const v = ok(await sb.rpc("void_fn"), "void");
    assertEq([v.data, v.status], [null, 204], "void → 204 null");
    const nWarn = warnings.length;
    const unknown = await sb.rpc("does_not_exist", { a: 1 });
    errCode(unknown, "PGRST202", "unknown RPC");
    assert(warnings.slice(nWarn).some((w) => w.includes("does_not_exist")), "console.warn for unknown RPC");
    const before = db.rows("labels").length;
    const f = await sb.rpc("write_then_fail", { wid: W.company });
    errCode(f, "P0001", "returned error");
    assertEq(f.error?.message, "not_found", "message passed through");
    assertEq(db.rows("labels").length, before, "writes of a failing RPC (ctx.from + ctx.db) are rolled back");
    const t2 = await sb.rpc("write_then_throw", { wid: W.company });
    errCode(t2, "42501", "thrown PgException");
    assertEq(t2.status, 403, "42501 → 403");
    assertEq(db.rows("labels").length, before, "rolled back after throw");
    const okr = ok(await sb.rpc("write_ok", { wid: W.company }), "rpc writes");
    assertEq(((okr.data as Row).label as Row).name, "rpc-ok", "ctx.from(...).insert().select().single() inside RPC");
    assertEq((okr.data as Row).nested, "hello nested", "ctx.rpc nested call");
    assert(db.rows("labels").some((l) => l.name === "rpc-ok"), "committed");
  });

  // ------------------------------------------------------------------ transactions
  await test("transaction(): undo log keeps concurrent writes of others", async () => {
    const tx = db.transaction(async (t) => {
      t.insert("labels", { workspace_id: W.company, name: "tx-1" });
      // a concurrent request writes meanwhile
      db.insert("labels", { workspace_id: W.company, name: "concurrent" });
      await Promise.resolve();
      t.update("labels", (r) => r.name === "tx-1", { color: "#000000" });
      throw new Error("boom");
    });
    let threw = false;
    try {
      await tx;
    } catch {
      threw = true;
    }
    assert(threw, "rejection propagates");
    assert(!db.rows("labels").some((l) => l.name === "tx-1"), "tx changes undone");
    assert(db.rows("labels").some((l) => l.name === "concurrent"), "concurrent write kept");
    const sync = db.transaction((t) => t.insert("labels", { workspace_id: W.company, name: "tx-ok" }));
    assertEq(sync.name, "tx-ok", "sync commit returns value");
  });

  // ------------------------------------------------------------------ recorder
  await test("recorder: builder reuse, verb cloning, await twice, throwOnError, JSON (browser) round trip", async () => {
    let query = sb.from("documents").select("id, title").eq("workspace_id", W.company);
    query = query.eq("status", "completed");
    query = query.order("created_at", { ascending: false }).limit(10);
    const r = ok(await query, "query = query.eq(...)");
    assertEq((r.data as Row[]).map((x) => x.id), [D.done], "mutable builder chain");
    const r2 = ok(await query, "await again");
    assertEq(r2.data, r.data, "awaiting twice re-executes with the same result");
    const base = sb.from("documents");
    const a = base.select("id").eq("id", D.done);
    const b = base.select("title").eq("id", D.done);
    assertEq([(await a).data, (await b).data], [[{ id: D.done }], [{ title: "완료된 계약" }]], "verbs clone (independent builders from one from())");
    let caught: unknown = null;
    try {
      await sb.from("documents").select("id").eq("id", "bad").throwOnError();
    } catch (e) {
      caught = e;
    }
    assert(caught instanceof Error && (caught as { code?: string }).code === "22P02" && (caught as Error).name === "PostgrestError", "throwOnError rejects with a PostgrestError");
    const catchRes = await sb
      .from("documents")
      .select("id")
      .eq("id", D.done)
      .then((x) => x.data);
    assertEq(catchRes, [{ id: D.done }], ".then(cb) works");
    const bsb = browser(asUser(U.admin, "admin@example.test"));
    const viaJson = ok(await bsb.from("custom_fields").select("id, name, type, required, placeholder, default_value, options").eq("workspace_id", W.company).order("created_at", { ascending: true }), "browser path");
    assert((viaJson.data as Row[]).length === 30, "browser round trip (custom fields list)");
    const insJson = ok(await bsb.from("labels").insert({ workspace_id: W.company, name: "브라우저", created_at: new Date("2026-01-02T03:04:05Z") as unknown as string }).select("created_at").single(), "Date in body");
    assertEq((insJson.data as Row).created_at, "2026-01-02T03:04:05.000Z", "Date → ISO through JSON like supabase-js");
    const missing = await (sb.from("documents") as unknown as PromiseLike<PgResult>);
    errCode(missing, "PGRST100", "awaiting from() without a verb");
    const unknownMethod = await executeDataOp({ kind: "from", table: "documents", chain: [{ m: "select", a: ["id"] }, { m: "bogus", a: [] }] }, ADMIN, { db, rpcs });
    errCode(unknownMethod, "PGRST100", "unknown builder method");
    const malformed = await executeDataOp({ kind: "nope" } as unknown as DataOp, ADMIN, { db, rpcs });
    errCode(malformed, "PGRST100", "malformed op");
  });

  await test("more real chains: data export, reminders, mailbox, signatures scope, auth username lookup", async () => {
    const REQUESTED = ["in_progress", "completed", "rejected", "signing_cancelled", "request_cancelled"];
    const de = ok(
      await sb
        .from("documents")
        .select(`id, title, status, request_type, owner_id, requested_at, completed_at, participants(name, email, status, order_index), fields(type, page, x, y, options, value, filled_at)`)
        .eq("workspace_id", W.company)
        .not("requested_at", "is", null)
        .in("status", REQUESTED)
        .gte("requested_at", "2000-01-01T00:00:00.000Z")
        .lt("requested_at", "2100-01-01T00:00:00.000Z")
        .order("requested_at", { ascending: false })
        .limit(5000),
      "data export",
    );
    assertEq((de.data as Row[]).map((x) => x.id), [D.done], "export rows");
    const rem = ok(await sb.from("document_events").select("document_id, created_at").eq("type", "reminded").in("document_id", [D.done]).order("created_at", { ascending: false }), "reminders");
    assertEq(rem.data, [], "no reminders");
    const term = "example";
    const mb = ok(
      await sb
        .from("outbound_emails")
        .select("id, to_email, to_name, subject, kind, delivered, created_at")
        .order("created_at", { ascending: false })
        .limit(50)
        .or(`to_email.ilike.%${term}%,subject.ilike.%${term}%,to_name.ilike.%${term}%`),
      "mailbox",
    );
    assertEq(mb.data, [], "no mails");
    const login = ok(await sb.from("profiles").select("email").eq("username", "ADMIN".toLowerCase()).maybeSingle(), "login by username");
    assertEq(login.data, { email: "admin@example.test" }, "username → email");
    ok(await sb.from("signatures").insert([{ user_id: U.admin, workspace_id: W.company, kind: "sign", image_data: "data:a", is_default: true }, { user_id: U.admin, workspace_id: null, kind: "sign", image_data: "data:b", is_default: false }, { user_id: U.admin, workspace_id: W.other, kind: "sign", image_data: "data:c", is_default: false }]), "signatures");
    const scope = `workspace_id.eq.${W.company},workspace_id.is.null`;
    const scoped = ok(await sb.from("signatures").select("id, is_default").eq("user_id", U.admin).eq("kind", "sign").or(scope), "scopeFilter");
    assertEq((scoped.data as Row[]).length, 2, "or(eq, is.null) scope");
    const latest = ok(await sb.from("signatures").select("id").eq("user_id", U.admin).eq("kind", "sign").or(scope).order("created_at", { ascending: false }).limit(1).maybeSingle(), "latest");
    assert(latest.data, "maybeSingle after limit(1)");
    const upd = ok(await sb.from("signatures").update({ is_default: false }).eq("user_id", U.admin).eq("kind", "sign").eq("is_default", true).or(scope).select("id"), "update with or()");
    assertEq((upd.data as Row[]).length, 1, "one default reset");
    const ids = db.rows("profiles").map((p) => p.id as string);
    const owners = ok(await sb.from("profiles").select("id, name, email, avatar_color").in("id", ids), "loadOwners");
    assertEq((owners.data as Row[]).length, ids.length, "in() over uuids");
  });

  await test("transforms: like(any), isDistinct, textSearch, order by embedded column, stripNulls, csv, maxAffected", async () => {
    const any = ok(await sb.from("documents").select("id").likeAnyOf("title", ["%완료%", "%초안%"]), "likeAnyOf");
    assertEq((any.data as Row[]).length, 2, "like(any)");
    const all = ok(await sb.from("documents").select("id").ilikeAllOf("title", ["%완료%", "%계약%"]), "ilikeAllOf");
    assertEq((all.data as Row[]).map((x) => x.id), [D.done], "ilike(all)");
    const dist = ok(await sb.from("documents").select("id").eq("workspace_id", W.company).isDistinct("completed_at", null), "isDistinct");
    assertEq((dist.data as Row[]).map((x) => x.id), [D.done], "is distinct from null");
    const fts = ok(await sb.from("documents").select("id").textSearch("title", "완료된 계약"), "textSearch");
    assertEq((fts.data as Row[]).map((x) => x.id), [D.done], "naive fts");
    const byEmbed = ok(await sb.from("participants").select("id, documents(title)").in("document_id", [D.done, D.draft]).order("documents(title)", { ascending: false }), "order by to-one embed");
    assertEq((byEmbed.data as Row[]).map((x) => (x.documents as Row).title), ["초안 문서", "완료된 계약"], "order=documents(title).desc");
    const stripped = ok(await sb.from("documents").select("id, scheduled_at").eq("id", D.done).stripNulls().single(), "stripNulls");
    assert(!("scheduled_at" in (stripped.data as Row)), "nulls stripped");
    const csv = ok(await sb.from("labels").select("name").eq("id", L.b).csv(), "csv");
    assertEq(csv.data, ["name", "인사"].join("\n"), "csv text");
    const colorsBefore = db.rows("labels").map((l) => l.color);
    errCode(await sb.from("labels").update({ color: "#abcdef" }).eq("workspace_id", W.company).maxAffected(1), "PGRST124", "maxAffected");
    assertEq(db.rows("labels").map((l) => l.color), colorsBefore, "maxAffected violation rolls back");
    errCode(await sb.from("documents").select("id").filter("id", "sl", "[1,2]"), "PGRST100", "range operators are reported");
    const lim = ok(await sb.from("labels").delete().eq("workspace_id", W.company).like("name", "field%").order("name").limit(1).select("name"), "delete + order + limit");
    assertEq((lim.data as Row[]).length <= 1, true, "limit on delete");
  });

  await test("global db: lazy creation from supabase/migrations, init/seed ordering, reset, HMR-safe views", async () => {
    const g = previewGlobals();
    const saved = { db: g.db, init: g.dbInit };
    try {
      resetPreviewDb();
      delete g.dbInit;
      const first = getPreviewDb();
      assertEq(first.rows("profiles"), [], "created empty (no initializer yet)");
      let seeded = 0;
      const seed = (d: { insert(t: string, r: Row): Row }) => {
        seeded++;
        d.insert("profiles", { id: "00000000-0000-4000-8000-000000000001", email: "demo@example.test", name: "데모" });
      };
      const second = getPreviewDb(seed);
      assertEq([seeded, second.rows("profiles").length], [1, 1], "initializer runs on the existing state once");
      getPreviewDb(seed);
      assertEq(seeded, 1, "not twice");
      const viaDefault = ok(await executeDataOp({ kind: "from", table: "profiles", chain: [{ m: "select", a: ["name"] }] }, ADMIN), "default db");
      assertEq(viaDefault.data, [{ name: "데모" }], "executeDataOp uses the shared db by default");
      const fake = { state: second.state, log: null, ctx: {} };
      assert(asEngineDb(fake)?.rows("profiles").length === 1, "duck-typed view (module copy after HMR)");
      const viaFake = ok(await executeDataOp({ kind: "from", table: "profiles", chain: [{ m: "select", a: ["id"] }] }, ADMIN, { db: fake as unknown as Db }), "fake db");
      assertEq((viaFake.data as Row[]).length, 1, "accepted");
      resetPreviewDb();
      const third = getPreviewDb();
      assertEq([seeded, third.rows("profiles").length], [2, 1], "reset → re-created and re-seeded");
      const failing = () => {
        throw new Error("seed failed");
      };
      resetPreviewDb();
      let threw = false;
      try {
        getPreviewDb(failing);
      } catch {
        threw = true;
      }
      assert(threw && !g.db, "a failing seed discards the state");
    } finally {
      if (saved.db) g.db = saved.db;
      else delete g.db;
      if (saved.init) g.dbInit = saved.init;
      else delete g.dbInit;
    }
  });

  const dt = Date.now() - t0;
  const gapWarnings = warnings.filter((w) => w.startsWith("[preview]")).length;
  console.log(`\n${failed ? "FAILED" : "PASSED"}: ${passed} passed, ${failed} failed (${dt} ms; ${gapWarnings} expected [preview] warnings${VERBOSE ? "" : " hidden, --verbose shows them"})`);
  if (failed) for (const f of failures) console.log(` - ${f.split("\n")[0]}`);
  return failed === 0;
}
