/**
 * Demo data of preview mode (fictional people, `.test` / `example.com` addresses, "(샘플)" documents).
 *
 *  * company "우리회사 워크스페이스" with 관리자 (admin, owner), 김민수 (minsu, member), 이서연 (seoyeon,
 *    admin) — created through the same handle_new_user logic as real accounts (+ personal workspaces)
 *  * documents in every 문서함 status with participants, fields on the drawn signature boxes,
 *    진행 이력 (document_events) and the e-mails that "were sent" (outbound_emails)
 *  * labels, templates (one single-role for 대량전송 / 링크서명), a bulk send, a link sign, contacts,
 *    custom fields, groups, an approval line + approval, a 서식 draft, an editing document, a
 *    saved signature and a shared company stamp
 *
 * Lazily seeded on first access (`ensureSeeded`), kept on globalThis (HMR-safe); `resetPreview()`
 * rebuilds it. Ids are deterministic, so URLs and the session cookie survive a reset / restart.
 */
import { createHash } from "node:crypto";

import { cancelledEmail, completedEmail, emailLayout, rejectedEmail, signRequestEmail } from "@/lib/email/templates";

import { createAuthUser } from "./auth";
import { DEMO } from "./demo";
import { getPreviewDb, previewGlobals, resetPreviewDb } from "./engine/db";
import { buildSamplePdfs, type PartySlot, type Rect, type SampleKind, type SamplePdf } from "./sample-pdfs";
import { signaturePngDataUrl, stampPngDataUrl } from "./sample-images";
import { putObject } from "./storage-state";
import type { PreviewDb, Row } from "./types";

/* ------------------------------------------------------------------ assets */

interface SeedAssets {
  pdfs: Record<SampleKind, SamplePdf>;
  signatures: string[];
  stamp: string;
}

const ASSET_VERSION = 1;

/** Sample PDFs / images, built once per server process (≈ 4 s) and kept across resets. */
function seedAssets(): Promise<SeedAssets> {
  const g = previewGlobals();
  if (!g.seedAssets || g.seedAssetsVersion !== ASSET_VERSION) {
    g.seedAssetsVersion = ASSET_VERSION;
    g.seedAssets = (async () => {
      const started = Date.now();
      const pdfs = await buildSamplePdfs();
      const assets: SeedAssets = {
        pdfs,
        signatures: Array.from({ length: 12 }, (_, i) => signaturePngDataUrl(i + 1)),
        stamp: stampPngDataUrl(),
      };
      console.info(`[preview] sample documents generated in ${Date.now() - started} ms`);
      return assets;
    })().catch((e) => {
      delete g.seedAssets;
      throw e;
    });
  }
  return g.seedAssets as Promise<SeedAssets>;
}

/** The seeded preview database (creates + seeds it on first use). */
export async function ensureSeeded(): Promise<PreviewDb> {
  const assets = await seedAssets();
  return getPreviewDb((db) => seed(db, assets));
}

/** 데모 데이터 초기화: drops every row, account and stored file, then seeds again. */
export async function resetPreview(): Promise<void> {
  resetPreviewDb();
  await ensureSeeded();
  console.info("[preview] demo data reset");
}

/* ------------------------------------------------------------------ helpers */

/** deterministic uuid (v4 layout) for a seed key */
function sid(key: string): string {
  const h = createHash("sha256").update(`opensign/preview/${key}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((parseInt(h[16], 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const KST = 9 * HOUR;

const IPS = ["203.0.113.24", "198.51.100.37", "203.0.113.58", "198.51.100.82", "203.0.113.91"];
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

function appLink(path: string) {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return `${base}${path}`;
}

function seoulDay(iso: string) {
  return new Date(Date.parse(iso) + KST).toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ people */

const PEOPLE = {
  admin: { name: "관리자", email: "admin@company.test" },
  minsu: { name: "김민수", email: "kim@company.test" },
  seoyeon: { name: "이서연", email: "lee@company.test" },
  haneul: { name: "정하늘", email: "haneul.jung@example.com" },
  yujin: { name: "최유진", email: "yujin.choi@example.com" },
  seojun: { name: "윤서준", email: "seojun.yoon@example.com" },
  yerin: { name: "강예린", email: "yerin.kang@example.com" },
  jia: { name: "송지아", email: "jia.song@example.com" },
  doyun: { name: "한도윤", email: "doyun.han@example.com" },
  mirae: { name: "임미래", email: "mirae.lim@example.com" },
  taeho: { name: "배태호", email: "taeho.bae@example.com" },
} as const;
type PersonKey = keyof typeof PEOPLE;
const MEMBERS = { admin: DEMO.users.admin, minsu: DEMO.users.minsu, seoyeon: DEMO.users.seoyeon } as const;
type MemberKey = keyof typeof MEMBERS;
const SIGNATURE_INDEX: Record<PersonKey, number> = {
  admin: 0,
  minsu: 1,
  seoyeon: 2,
  haneul: 3,
  yujin: 4,
  seojun: 5,
  yerin: 6,
  jia: 7,
  doyun: 8,
  mirae: 9,
  taeho: 10,
};

/* ------------------------------------------------------------------ seed */

interface PSpec {
  who: PersonKey;
  /** signature-block slot on the sample PDF */
  slot: number;
  status: "waiting" | "pending" | "signed" | "viewed" | "rejected";
  sentAt?: string;
  viewedAt?: string;
  signedAt?: string;
  rejectedAt?: string;
  rejectReason?: string;
  roleLabel?: string;
}

interface DSpec {
  key: string;
  kind: SampleKind;
  title: string;
  owner: MemberKey;
  status: "draft" | "scheduled" | "in_progress" | "completed" | "rejected" | "signing_cancelled" | "request_cancelled";
  requestType?: "sign" | "view";
  order?: "sequential" | "parallel";
  labels?: string[];
  createdAt: string;
  requestedAt?: string;
  completedAt?: string;
  scheduledAt?: string;
  cancelledAt?: string;
  expiredAt?: string;
  expiresDays?: number;
  message?: string;
  cc?: { name: string; email: string }[];
  templateId?: string;
  participants: PSpec[];
}

function seed(db: PreviewDb, assets: SeedAssets) {
  const now = Date.now();
  /** `daysAgo` days back at hh:mm Korea time (never in the future) */
  const ago = (daysAgo: number, hh = 10, mm = 0) => {
    const day = new Date(now - daysAgo * DAY + KST);
    const t = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hh, mm) - KST;
    return new Date(Math.min(t, now - 5 * MIN)).toISOString();
  };
  const ahead = (days: number, hh = 9, mm = 0) => {
    const day = new Date(now + days * DAY + KST);
    return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hh, mm) - KST).toISOString();
  };
  const plus = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString();
  const wid = DEMO.workspaces.company;

  /* ---------------------------------------------------------------- accounts */
  createAuthUser(
    db,
    {
      id: DEMO.users.admin,
      email: PEOPLE.admin.email,
      password: "Admin1234!",
      email_confirm: true,
      user_metadata: { name: "관리자", username: "admin", role: "owner", company: "우리회사", department: "경영지원팀", position: "팀장" },
    },
    { companyWorkspaceId: wid, personalWorkspaceId: DEMO.workspaces.adminPersonal, createdAt: ago(40, 9) },
  );
  createAuthUser(
    db,
    {
      id: DEMO.users.minsu,
      email: PEOPLE.minsu.email,
      password: "Test1234!",
      email_confirm: true,
      user_metadata: { name: "김민수", username: "minsu", role: "member", department: "영업팀", position: "대리" },
    },
    { personalWorkspaceId: DEMO.workspaces.minsuPersonal, createdAt: ago(39, 9, 30) },
  );
  createAuthUser(
    db,
    {
      id: DEMO.users.seoyeon,
      email: PEOPLE.seoyeon.email,
      password: "Test1234!",
      email_confirm: true,
      user_metadata: { name: "이서연", username: "seoyeon", role: "admin", department: "법무팀", position: "과장" },
    },
    { personalWorkspaceId: DEMO.workspaces.seoyeonPersonal, createdAt: ago(39, 10) },
  );
  db.update("profiles", (p) => p.id === DEMO.users.minsu, { avatar_color: "#c8e6c9" });
  db.update("profiles", (p) => p.id === DEMO.users.seoyeon, { avatar_color: "#bbdefb" });

  /* ------------------------------------------------------------------ groups */
  const groups: [string, MemberKey[]][] = [
    ["경영지원팀", ["admin"]],
    ["영업팀", ["minsu"]],
    ["법무팀", ["seoyeon"]],
  ];
  for (const [name, members] of groups) {
    const g = db.insert("groups", { id: sid(`group:${name}`), workspace_id: wid, name, created_at: ago(38, 9) });
    for (const m of members) db.insert("group_members", { group_id: g.id, user_id: MEMBERS[m], created_at: ago(38, 9) });
  }

  /* ------------------------------------------------------------------ labels */
  const LABELS: Record<string, { name: string; color: string }> = {
    contract: { name: "계약", color: "#5991f4" },
    hr: { name: "인사", color: "#51c8aa" },
    legal: { name: "법무", color: "#9b8aff" },
    partner: { name: "거래처", color: "#ff8515" },
  };
  const labelId = (k: string) => sid(`label:${k}`);
  for (const [k, l] of Object.entries(LABELS)) db.insert("labels", { id: labelId(k), workspace_id: wid, name: l.name, color: l.color, created_at: ago(35, 9) });

  /* --------------------------------------------------------------- storage */
  const store = (path: string, kind: SampleKind, ownerId: string | null, at: string) =>
    putObject(db, "documents", path, assets.pdfs[kind].bytes, { contentType: "application/pdf", ownerId, trusted: true, upsert: true, at });

  /* -------------------------------------------------------- signatures/stamps */
  db.insert("signatures", {
    id: sid("signature:admin"),
    user_id: DEMO.users.admin,
    workspace_id: null,
    kind: "sign",
    name: "관리자 사인",
    image_data: assets.signatures[SIGNATURE_INDEX.admin],
    is_default: true,
    created_at: ago(30, 11),
  });
  db.insert("signatures", {
    id: sid("signature:company-stamp"),
    user_id: DEMO.users.admin,
    workspace_id: wid,
    kind: "stamp",
    name: "법인 도장 (샘플)",
    image_data: assets.stamp,
    is_default: false,
    shared: true,
    created_at: ago(30, 11, 5),
  });

  /* --------------------------------------------------------------- templates */
  const fieldSet = (slot: PartySlot, withCheckbox: boolean) => {
    const f: { type: string; rect: Rect; required: boolean; options: Record<string, unknown> }[] = [
      { type: "signature", rect: slot.signature, required: true, options: { signMode: "any" } },
      { type: "text", rect: slot.name, required: true, options: { autoFill: "name", label: "성명" } },
      { type: "signed_date", rect: slot.date, required: true, options: {} },
    ];
    if (withCheckbox && slot.checkbox) f.push({ type: "checkbox", rect: slot.checkbox, required: true, options: { label: "동의" } });
    return f;
  };

  const T_LABOR = sid("template:labor");
  const T_PRIVACY = sid("template:privacy");
  const templateRow = (id: string, kind: SampleKind, title: string, roles: { key: string; name: string }[], owner: MemberKey, at: string, labels: string[]) => {
    const pdf = assets.pdfs[kind];
    store(`${wid}/templates/${id}.pdf`, kind, MEMBERS[owner], at);
    const fields = roles.flatMap((r, i) =>
      fieldSet(pdf.slots[i], kind === "privacy").map((f) => ({
        role_key: r.key,
        type: f.type,
        page: 1,
        x: f.rect.x,
        y: f.rect.y,
        width: f.rect.width,
        height: f.rect.height,
        required: f.required,
        options: f.options,
      })),
    );
    db.insert("templates", {
      id,
      workspace_id: wid,
      owner_id: MEMBERS[owner],
      title,
      file_path: `${wid}/templates/${id}.pdf`,
      page_count: pdf.pageCount,
      page_sizes: pdf.pageSizes,
      request_type: "sign",
      signing_order: "sequential",
      roles: roles.map((r, i) => ({ key: r.key, name: r.name, color_index: i })),
      fields,
      label_ids: labels.map(labelId),
      pinned: false,
      shared: true,
      last_modified_by: MEMBERS[owner],
      created_at: at,
      updated_at: at,
    });
  };
  templateRow(T_LABOR, "labor", "근로계약서 (샘플)", [
    { key: "employer", name: "사업주" },
    { key: "employee", name: "근로자" },
  ], "admin", ago(28, 15), ["hr", "contract"]);
  templateRow(T_PRIVACY, "privacy", "개인정보 수집·이용 동의서 (샘플)", [{ key: "consenter", name: "동의자" }], "seoyeon", ago(27, 11), ["hr"]);
  db.insert("template_pins", { template_id: T_LABOR, user_id: DEMO.users.admin, created_at: ago(20, 9) });

  /* --------------------------------------------------------------- documents */
  const events: Row[] = [];
  const mails: Row[] = [];
  const ev = (documentId: string, type: string, actor: { name: string | null; email: string | null }, at: string, meta: Record<string, unknown> = {}, auto = false, ip?: string) =>
    events.push({
      document_id: documentId,
      type,
      actor_name: actor.name,
      actor_email: actor.email,
      ip: auto ? null : (ip ?? IPS[events.length % IPS.length]),
      user_agent: auto ? null : UA,
      meta: { ...meta, auto },
      created_at: at,
    });
  const mail = (documentId: string | null, to: { name: string; email: string }, m: { subject: string; html: string }, kind: string, at: string) =>
    mails.push({ document_id: documentId, to_email: to.email, to_name: to.name, subject: m.subject, html: m.html, kind, delivered: false, created_at: at });

  const docs: DSpec[] = [
    {
      key: "labor-completed",
      kind: "labor",
      title: "근로계약서 (샘플)",
      owner: "admin",
      status: "completed",
      labels: ["hr", "contract"],
      createdAt: ago(12, 9, 40),
      requestedAt: ago(12, 10),
      completedAt: ago(11, 16, 5),
      message: "근로계약서 내용을 확인하시고 서명 부탁드립니다.",
      cc: [{ name: "인사 담당", email: "hr-desk@example.com" }],
      participants: [
        { who: "haneul", slot: 1, status: "signed", sentAt: ago(12, 10), viewedAt: ago(11, 14, 20), signedAt: ago(11, 14, 26) },
        { who: "admin", slot: 0, status: "signed", sentAt: ago(11, 14, 26), viewedAt: ago(11, 16, 2), signedAt: ago(11, 16, 5) },
      ],
    },
    {
      key: "nda-need-my-sign",
      kind: "nda",
      title: "비밀유지 서약서 (샘플)",
      owner: "seoyeon",
      status: "in_progress",
      labels: ["legal"],
      createdAt: ago(3, 10, 50),
      requestedAt: ago(3, 11, 10),
      message: "연간 보안 서약 갱신 건입니다. 확인 후 서명해 주세요.",
      participants: [{ who: "admin", slot: 0, status: "pending", sentAt: ago(3, 11, 10) }],
    },
    {
      key: "supply-waiting-partner",
      kind: "supply",
      title: "물품 공급 계약서 (샘플)",
      owner: "admin",
      status: "in_progress",
      labels: ["contract", "partner"],
      createdAt: ago(2, 14, 40),
      requestedAt: ago(2, 15, 5),
      participants: [
        { who: "yujin", slot: 0, status: "pending", sentAt: ago(2, 15, 5), viewedAt: ago(1, 9, 12) },
        { who: "admin", slot: 1, status: "waiting" },
      ],
    },
    {
      key: "privacy-draft",
      kind: "privacy",
      title: "개인정보 수집·이용 동의서 (샘플)",
      owner: "admin",
      status: "draft",
      labels: ["hr"],
      createdAt: new Date(now - 2 * HOUR).toISOString(),
      participants: [{ who: "minsu", slot: 0, status: "waiting" }],
    },
    {
      key: "service-rejected",
      kind: "service",
      title: "용역 계약서 (샘플)",
      owner: "admin",
      status: "rejected",
      labels: ["contract"],
      createdAt: ago(7, 9, 50),
      requestedAt: ago(7, 10, 20),
      participants: [
        {
          who: "seojun",
          slot: 1,
          status: "rejected",
          sentAt: ago(7, 10, 20),
          viewedAt: ago(6, 13, 40),
          rejectedAt: ago(6, 13, 45),
          rejectReason: "계약 기간과 대가 지급 조건을 다시 협의하고 싶습니다.",
        },
        { who: "admin", slot: 0, status: "waiting" },
      ],
    },
    {
      key: "mou-cancelled",
      kind: "mou",
      title: "업무 협약서 (샘플)",
      owner: "seoyeon",
      status: "request_cancelled",
      labels: ["legal", "partner"],
      createdAt: ago(9, 13, 30),
      requestedAt: ago(9, 14, 10),
      cancelledAt: ago(8, 9, 30),
      participants: [
        { who: "yerin", slot: 1, status: "pending", sentAt: ago(9, 14, 10) },
        { who: "seoyeon", slot: 0, status: "waiting" },
      ],
    },
    {
      key: "labor-scheduled",
      kind: "labor",
      title: "근로계약서 (샘플) - 11월 입사자",
      owner: "admin",
      status: "scheduled",
      labels: ["hr"],
      createdAt: ago(1, 17),
      scheduledAt: ahead(3, 9),
      participants: [
        { who: "jia", slot: 1, status: "waiting", roleLabel: "근로자" },
        { who: "admin", slot: 0, status: "waiting", roleLabel: "사업주" },
      ],
      templateId: T_LABOR,
    },
    {
      key: "policy-view",
      kind: "policy",
      title: "사내 정보보안 정책 안내 (샘플)",
      owner: "seoyeon",
      status: "in_progress",
      requestType: "view",
      order: "parallel",
      labels: ["legal"],
      createdAt: ago(4, 8, 50),
      requestedAt: ago(4, 9, 5),
      message: "하반기 정보보안 정책입니다. 내용을 확인해 주세요.",
      participants: [
        { who: "admin", slot: 0, status: "pending", sentAt: ago(4, 9, 5) },
        { who: "minsu", slot: 0, status: "viewed", sentAt: ago(4, 9, 5), viewedAt: ago(4, 13, 22) },
      ],
    },
    {
      key: "supply-expired",
      kind: "supply",
      title: "물품 공급 계약서 (샘플) - 2차",
      owner: "minsu",
      status: "signing_cancelled",
      labels: ["partner"],
      createdAt: ago(25, 9, 40),
      requestedAt: ago(25, 10, 10),
      expiresDays: 7,
      expiredAt: ago(18, 10, 11),
      participants: [
        { who: "doyun", slot: 0, status: "pending", sentAt: ago(25, 10, 10) },
        { who: "minsu", slot: 1, status: "waiting" },
      ],
    },
    {
      key: "nda-completed",
      kind: "nda",
      title: "비밀유지 서약서 (샘플) - 김민수",
      owner: "seoyeon",
      status: "completed",
      labels: ["legal", "hr"],
      createdAt: ago(20, 9),
      requestedAt: ago(20, 9, 10),
      completedAt: ago(20, 11, 3),
      participants: [{ who: "minsu", slot: 0, status: "signed", sentAt: ago(20, 9, 10), viewedAt: ago(20, 11), signedAt: ago(20, 11, 3) }],
    },
  ];

  // 대량전송: two documents created from the single-role template
  const BULK_ID = sid("bulk:privacy");
  const BULK_TITLE = "개인정보 동의서 일괄 요청 (샘플)";
  const bulkRecipients: PersonKey[] = ["mirae", "taeho"];
  bulkRecipients.forEach((who, i) =>
    docs.push({
      key: `bulk-${who}`,
      kind: "privacy",
      title: BULK_TITLE,
      owner: "seoyeon",
      status: "in_progress",
      labels: ["hr"],
      createdAt: ago(5, 15, i),
      requestedAt: ago(5, 15, i),
      templateId: T_PRIVACY,
      participants: [
        i === 0
          ? { who, slot: 0, status: "pending", sentAt: ago(5, 15, i), viewedAt: ago(4, 18, 30), roleLabel: "동의자" }
          : { who, slot: 0, status: "pending", sentAt: ago(5, 15, i), roleLabel: "동의자" },
      ],
    }),
  );

  const docIdOf = (key: string) => sid(`doc:${key}`);

  for (const d of docs) {
    const id = docIdOf(d.key);
    const pdf = assets.pdfs[d.kind];
    const owner = PEOPLE[d.owner];
    const view = d.requestType === "view";
    const expiresDays = d.expiresDays ?? 14;
    const filePath = `${wid}/documents/${id}/original.pdf`;
    store(filePath, d.kind, MEMBERS[d.owner], d.createdAt);

    const timeline = [
      d.createdAt,
      d.requestedAt,
      d.completedAt,
      d.cancelledAt,
      d.expiredAt,
      ...d.participants.flatMap((p) => [p.sentAt, p.viewedAt, p.signedAt, p.rejectedAt]),
    ].filter((x): x is string => !!x);
    const lastActivity = timeline.reduce((a, b) => (Date.parse(b) > Date.parse(a) ? b : a));

    db.insert("documents", {
      id,
      workspace_id: wid,
      owner_id: MEMBERS[d.owner],
      template_id: d.templateId ?? null,
      title: d.title,
      status: d.status,
      request_type: view ? "view" : "sign",
      signing_order: d.order ?? "sequential",
      file_name: `${d.title}.pdf`,
      file_path: filePath,
      page_count: pdf.pageCount,
      page_sizes: pdf.pageSizes,
      expires_days: expiresDays,
      message: d.message ?? null,
      label_ids: (d.labels ?? []).map(labelId),
      scheduled_at: d.scheduledAt ?? null,
      requested_at: d.requestedAt ?? null,
      completed_at: d.completedAt ?? null,
      last_activity_at: lastActivity,
      created_at: d.createdAt,
      cc: d.cc ?? [],
    });

    const signers = d.participants.map((p) => ({ name: PEOPLE[p.who].name, email: PEOPLE[p.who].email }));
    const rows = d.participants.map((p, i) => {
      const person = PEOPLE[p.who];
      const pid = sid(`participant:${d.key}:${i}`);
      const token = sid(`token:${d.key}:${i}`);
      return db.insert("participants", {
        id: pid,
        document_id: id,
        order_index: i,
        role: view ? "viewer" : "signer",
        role_label: p.roleLabel ?? null,
        name: person.name,
        email: person.email,
        delivery: "email",
        locale: "ko",
        status: p.status,
        access_token: token,
        reject_reason: p.rejectReason ?? null,
        sent_at: p.sentAt ?? null,
        viewed_at: p.viewedAt ?? (p.status === "signed" ? (p.signedAt ?? null) : null),
        signed_at: p.signedAt ?? null,
        expires_at: p.sentAt ? plus(p.sentAt, expiresDays * DAY) : null,
        created_at: d.createdAt,
      });
    });

    // fields on the drawn signature boxes (sign requests)
    if (!view) {
      d.participants.forEach((p, i) => {
        const slot = pdf.slots[p.slot] ?? pdf.slots[0];
        if (!slot) return;
        const signed = p.status === "signed";
        for (const f of fieldSet(slot, d.kind === "privacy")) {
          let value: string | null = null;
          if (signed && p.signedAt) {
            if (f.type === "signature") value = assets.signatures[SIGNATURE_INDEX[p.who]];
            else if (f.type === "text") value = PEOPLE[p.who].name;
            else if (f.type === "signed_date") value = seoulDay(p.signedAt);
            else if (f.type === "checkbox") value = "true";
          }
          db.insert("fields", {
            id: sid(`field:${d.key}:${i}:${f.type}`),
            document_id: id,
            participant_id: rows[i].id,
            type: f.type,
            page: 1,
            x: f.rect.x,
            y: f.rect.y,
            width: f.rect.width,
            height: f.rect.height,
            required: f.required,
            options: f.options,
            value,
            filled_at: value !== null ? p.signedAt : null,
            created_at: d.createdAt,
          });
        }
      });
    }

    // 진행 이력 + mails
    if (d.requestedAt) ev(id, "created", owner, d.requestedAt, {}, false, IPS[0]);
    d.participants.forEach((p, i) => {
      const person = PEOPLE[p.who];
      const pid = rows[i].id as string;
      if (p.sentAt) {
        ev(id, "sent", person, p.sentAt, { participant_id: pid, delivery: "email" }, true);
        const m = signRequestEmail({
          title: d.title,
          requesterName: owner.name,
          requesterEmail: owner.email,
          signerName: person.name,
          signers,
          expiresAt: plus(p.sentAt, expiresDays * DAY),
          link: appLink(`/sign/${rows[i].access_token as string}`),
          message: d.message ?? null,
          view,
        });
        mail(id, person, m, "sign_request", p.sentAt);
      }
      if (p.viewedAt && !(view && p.status === "viewed")) ev(id, "viewed", person, p.viewedAt, { participant_id: pid });
      if (view && p.status === "viewed" && p.viewedAt) ev(id, "viewed", person, p.viewedAt, { participant_id: pid });
      if (p.signedAt) ev(id, "signed", person, p.signedAt, { participant_id: pid });
      if (p.rejectedAt) {
        ev(id, "rejected", person, p.rejectedAt, { participant_id: pid, reason: p.rejectReason ?? "" });
        mail(id, owner, rejectedEmail({ title: d.title, signerName: person.name, reason: p.rejectReason ?? "", link: appLink(`/workspaces/${wid}/documents/${id}`) }), "rejected", p.rejectedAt);
      }
    });
    if (d.completedAt) {
      ev(id, "completed", { name: null, email: null }, d.completedAt, {}, true);
      const recipients = [...signers, owner, ...(d.cc ?? [])].filter((r, i, all) => all.findIndex((x) => x.email === r.email) === i);
      for (const r of recipients) {
        const m = completedEmail({ title: d.title, requesterName: owner.name, signers, completedAt: d.completedAt, link: appLink(`/workspaces/${wid}/documents/${id}`), documentId: id });
        mail(id, r, m, "completed", d.completedAt);
      }
    }
    if (d.cancelledAt) {
      ev(id, "cancelled", owner, d.cancelledAt, {});
      d.participants
        .filter((p) => p.status === "pending")
        .forEach((p) => mail(id, PEOPLE[p.who], cancelledEmail({ title: d.title, requesterName: owner.name, reason: "협약 일정이 변경되어 요청을 취소합니다." }), "cancelled", d.cancelledAt as string));
    }
    if (d.expiredAt) {
      const pending = d.participants.find((p) => p.status === "pending");
      ev(id, "expired", { name: "시스템", email: null }, d.expiredAt, { participant: pending ? PEOPLE[pending.who].email : null }, true);
    }
  }

  for (const e of events.sort((a, b) => Date.parse(a.created_at as string) - Date.parse(b.created_at as string))) db.insert("document_events", e);

  /* --------------------------------------------------------------- bulk / link */
  db.insert("bulk_sends", {
    id: BULK_ID,
    workspace_id: wid,
    owner_id: DEMO.users.seoyeon,
    template_id: T_PRIVACY,
    title: BULK_TITLE,
    status: "sent",
    recipients: bulkRecipients.map((who) => ({
      name: PEOPLE[who].name,
      email: PEOPLE[who].email,
      status: "sent",
      document_id: docIdOf(`bulk-${who}`),
      error: null,
      processed_at: ago(5, 15, 2),
    })),
    created_at: ago(5, 14, 58),
    sent_at: ago(5, 15, 2),
  });
  db.insert("link_signs", {
    id: sid("link:privacy"),
    workspace_id: wid,
    owner_id: DEMO.users.seoyeon,
    template_id: T_PRIVACY,
    title: "개인정보 수집·이용 동의 링크 (샘플)",
    token: sid("link-token:privacy"),
    active: true,
    label_ids: [labelId("hr")],
    created_at: ago(15, 10),
    last_activity_at: ago(15, 10),
  });

  /* ---------------------------------------------------------- 주소록 / 입력란 */
  const contacts = [
    { name: "정하늘", email: PEOPLE.haneul.email, phone: "010-0000-0101", company: "샘플상사", position: "대리", description: "신규 입사자" },
    { name: "최유진", email: PEOPLE.yujin.email, phone: "010-0000-0102", company: "다온물산 (샘플)", position: "영업팀장", description: "사무용품 공급 거래처" },
    { name: "윤서준", email: PEOPLE.seojun.email, phone: null, company: "서준디자인 (샘플)", position: "대표", description: "브랜드 디자인 용역" },
    { name: "강예린", email: PEOPLE.yerin.email, phone: "010-0000-0104", company: "한빛재단 (샘플)", position: "협력팀 매니저", description: null },
  ];
  contacts.forEach((c, i) =>
    db.insert("contacts", {
      id: sid(`contact:${i}`),
      workspace_id: wid,
      owner_id: DEMO.users.admin,
      name: c.name,
      email: c.email,
      phone: c.phone,
      default_channel: "email",
      description: c.description,
      company: c.company,
      position: c.position,
      business_no: null,
      created_at: ago(26 - i, 10),
    }),
  );
  const customFields = [
    { name: "사번", type: "text", required: true, placeholder: "예: A-0001", options: [] as string[] },
    { name: "입사일", type: "date", required: false, placeholder: null, options: [] },
    { name: "소속 부서", type: "dropdown", required: false, placeholder: "부서 선택", options: ["경영지원팀", "영업팀", "법무팀"] },
  ];
  customFields.forEach((c, i) =>
    db.insert("custom_fields", {
      id: sid(`custom-field:${i}`),
      workspace_id: wid,
      owner_id: DEMO.users.admin,
      name: c.name,
      type: c.type,
      required: c.required,
      placeholder: c.placeholder,
      default_value: null,
      options: c.options,
      created_at: ago(24, 10, i),
    }),
  );

  /* ---------------------------------------------------------------- 내부결재 */
  const lineId = sid("approval-line:default");
  const approver = (k: MemberKey) => ({ user_id: MEMBERS[k], name: PEOPLE[k].name, email: PEOPLE[k].email });
  db.insert("approval_lines", {
    id: lineId,
    workspace_id: wid,
    owner_id: DEMO.users.minsu,
    name: "기본 결재선 (샘플)",
    approvers: [approver("seoyeon"), approver("admin")],
    created_at: ago(22, 10),
    updated_at: ago(22, 10),
    last_activity_at: ago(2, 10, 30),
  });
  const approvalId = sid("approval:laptops");
  const approvalPath = `${wid}/approvals/${approvalId}.pdf`;
  store(approvalPath, "purchase", DEMO.users.minsu, ago(2, 10, 30));
  const submittedAt = ago(2, 10, 30);
  const reviewedAt = ago(2, 14, 5);
  db.insert("approvals", {
    id: approvalId,
    workspace_id: wid,
    drafter_id: DEMO.users.minsu,
    title: "업무용 노트북 구매 품의 (샘플)",
    file_name: "구매 품의서 (샘플).pdf",
    file_path: approvalPath,
    page_count: 1,
    message: "신규 입사자 장비 구매 건입니다. 검토 부탁드립니다.",
    status: "in_progress",
    approvers: [
      { ...approver("seoyeon"), status: "approved", comment: "견적 확인했습니다.", acted_at: reviewedAt },
      { ...approver("admin"), status: "pending", comment: null, acted_at: null },
    ],
    line_id: lineId,
    created_at: submittedAt,
    last_activity_at: reviewedAt,
  });
  db.insert("approval_events", { approval_id: approvalId, type: "submitted", actor_id: DEMO.users.minsu, actor_name: "김민수", actor_email: PEOPLE.minsu.email, comment: "신규 입사자 장비 구매 건입니다. 검토 부탁드립니다.", created_at: submittedAt });
  db.insert("approval_events", { approval_id: approvalId, type: "approved", actor_id: DEMO.users.seoyeon, actor_name: "이서연", actor_email: PEOPLE.seoyeon.email, comment: "견적 확인했습니다.", created_at: reviewedAt });
  const approvalLink = appLink(`/workspaces/${wid}/esign/requests/approvals/${approvalId}`);
  for (const [to, at] of [
    [PEOPLE.seoyeon, submittedAt],
    [PEOPLE.admin, reviewedAt],
  ] as const) {
    mail(
      null,
      to,
      {
        subject: `[결재요청] '업무용 노트북 구매 품의 (샘플)' 결재를 요청받았습니다.`,
        html: emailLayout({
          heading: "결재 요청이 도착했습니다.",
          lead: ["김민수님이 결재를 요청했습니다.", "아래 버튼을 눌러 내용을 확인하고 승인 또는 반려해 주세요."],
          rows: [
            { label: "기안 제목", value: ["업무용 노트북 구매 품의 (샘플)"] },
            { label: "기안자", value: ["김민수 (kim@company.test)"] },
          ],
          cta: { label: "결재하기", href: approvalLink },
        }),
      },
      "approval",
      at,
    );
  }

  /* -------------------------------------------------------------- 편집 / 서식 */
  const editingId = sid("editing:minutes");
  const editingPath = `${wid}/editing/${editingId}.pdf`;
  store(editingPath, "minutes", DEMO.users.admin, ago(6, 16));
  db.insert("editing_documents", {
    id: editingId,
    workspace_id: wid,
    owner_id: DEMO.users.admin,
    title: "주간 회의록 (샘플)",
    file_name: "주간 회의록 (샘플).pdf",
    file_path: editingPath,
    status: "editing",
    annotations: [{ id: "note-1", type: "text", page: 1, x: 410, y: 140, width: 130, height: 20, text: "검토 필요", fontSize: 12, color: "#e42929" }],
    created_at: ago(6, 16),
    last_activity_at: ago(6, 16, 20),
  });
  db.insert("drafts", {
    id: sid("draft:quote"),
    workspace_id: wid,
    owner_id: DEMO.users.admin,
    title: "견적 요청서 서식 (샘플)",
    content: [
      '<h1 style="text-align: center">견적 요청서 (샘플)</h1>',
      "<p>아래 품목에 대한 견적을 요청드립니다. 회신 기한 내에 견적서를 보내 주시기 바랍니다.</p>",
      "<h2>1. 요청 품목</h2>",
      "<ul><li>사무용 노트북 3대</li><li>27인치 모니터 3대</li><li>무선 키보드·마우스 세트 3개</li></ul>",
      "<h2>2. 납품 조건</h2>",
      "<p>납품 장소: 본사 3층 · 희망 납기: 요청일로부터 2주 이내</p>",
      "<hr>",
      "<p><em>이 서식은 미리보기용 샘플입니다.</em></p>",
    ].join(""),
    created_at: ago(10, 11),
    updated_at: ago(10, 11, 40),
  });

  for (const m of mails.sort((a, b) => Date.parse(a.created_at as string) - Date.parse(b.created_at as string))) db.insert("outbound_emails", m);

  db.meta.previewSeeded = true;
  db.meta.previewSeededAt = new Date(now).toISOString();
  console.info(`[preview] demo data seeded: ${docs.length} documents, ${events.length} events, ${mails.length} mails`);
}
