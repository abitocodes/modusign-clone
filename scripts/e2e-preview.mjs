// End-to-end click-through of PREVIEW MODE (mock backend, no Supabase / SMTP):
//   fake login → every sidebar / settings page → 사인·도장 → request wizard (2 external signers,
//   sequential) → signer page (본인 확인 건너뛰기 · 자동 입력) → "모든 서명자 서명 완료 처리 (미리보기)"
//   → 완료 문서 / downloads → 보낸 메일함 → 템플릿 → 대량전송 → 링크서명 → 서명 거절 → 내부결재.
// Every page must render without console errors, page errors or 5xx responses, and the server log
// must not contain "[preview]" warnings or errors.
// Usage:  npm run test:preview [-- --headed] [-- --only crawl,wizard]
//   * uses a preview server already listening on --base (default http://localhost:3100) — pass
//     --log <file> with its output to check the server log too — or else starts `npm run dev:preview`
//     itself on that port, checks its output and stops it at the end
//   * sections (--only): crawl, signatures, wizard, templates, bulk, links, reject, approvals
//     (bulk and links use the template made by "templates" when it ran)
// Uses the system Google Chrome through playwright-core (no browser download).
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PDFDocument, StandardFonts } from "pdf-lib";
import { chromium } from "playwright-core";

const args = process.argv.slice(2);
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const BASE = arg("--base", "http://localhost:3100");
const HEADED = args.includes("--headed");
const LOG = arg("--log", null);
const ONLY = arg("--only", null);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/** fake credentials: preview mode signs any id/password in */
const FAKE = { id: `nobody-${Math.random().toString(36).slice(2, 8)}`, password: `pw-${Math.random().toString(36).slice(2)}` };
const STAMP = Date.now().toString(36);

const problems = [];
let current = "start";
const step = (m) => {
  current = m;
  console.log(`• ${m}`);
};
const problem = (m) => {
  const line = `[${current}] ${m}`;
  if (!problems.includes(line)) problems.push(line);
  console.log(`  ! ${m}`);
};
const check = (cond, m) => {
  if (!cond) throw new Error(m);
};

const logStart = LOG && existsSync(LOG) ? readFileSync(LOG, "utf8").length : 0;

/* ----------------------------------------------------------------------------- preview server */

const reachable = () =>
  fetch(`${BASE}/login`, { redirect: "manual" }).then(
    (r) => r.status > 0,
    () => false,
  );

/** output of the preview server this script started (null: an external server is used) */
let ownServer = null;

async function ensureServer() {
  if (await reachable()) return;
  const port = new URL(BASE).port || "3100";
  console.log(`• starting npm run dev:preview on port ${port}`);
  const child = spawn(process.execPath, [path.join(ROOT, "scripts", "dev-preview.mjs")], {
    cwd: ROOT,
    env: { ...process.env, PREVIEW_PORT: port },
    stdio: ["ignore", "pipe", "pipe"],
  });
  ownServer = { child, output: "" };
  const collect = (chunk) => (ownServer.output += chunk.toString());
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  const end = Date.now() + 180_000;
  while (Date.now() < end) {
    if (child.exitCode !== null) throw new Error(`dev:preview exited (${child.exitCode}):\n${ownServer.output.slice(-2000)}`);
    if (await reachable()) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("dev:preview did not start within 180 s");
}

function stopServer() {
  if (!ownServer?.child.pid || ownServer.child.exitCode !== null) return;
  // the launcher runs `next dev` through a shell on Windows: end the whole process tree
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(ownServer.child.pid), "/T", "/F"], { stdio: "ignore" });
  else ownServer.child.kill("SIGTERM");
}

/* ------------------------------------------------------------------------------------ helpers */

async function makePdf(title, pages = 1) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([595, 842]);
    page.drawText(`Preview E2E document - page ${i + 1}`, { x: 60, y: 760, size: 22, font });
    page.drawText("Signature:", { x: 60, y: 600, size: 12, font });
  }
  const dir = mkdtempSync(path.join(tmpdir(), "e2e-preview-"));
  const file = path.join(dir, `${title}.pdf`);
  writeFileSync(file, await doc.save());
  return file;
}

const IGNORED_CONSOLE = [
  /Download the React DevTools/i,
  /\[HMR\]/,
  /\[Fast Refresh\]/,
  // pdf.js informational warnings
  /Warning: TT:/,
];

function watch(page, label) {
  page.on("console", (msg) => {
    if (msg.type() !== "error" && msg.type() !== "warning") return;
    const text = msg.text();
    if (IGNORED_CONSOLE.some((r) => r.test(text))) return;
    if (msg.type() === "warning" && !/\[preview\]/.test(text)) return;
    problem(`${label} console.${msg.type()}: ${text.slice(0, 300)} @ ${page.url()}`);
  });
  page.on("pageerror", (err) => problem(`${label} pageerror: ${String(err.message).slice(0, 300)} @ ${page.url()}`));
  page.on("response", (res) => {
    if (res.status() >= 500) problem(`${label} HTTP ${res.status()} ${res.request().method()} ${res.url()}`);
  });
}

/** fails when the page shows an error boundary / 404 page */
async function assertRendered(page, what) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(150);
  const body = await page.locator("body").innerText({ timeout: 10000 }).catch(() => "");
  if (/페이지를 찾을 수 없습니다|일시적인 문제일 수 있습니다|Unhandled Runtime Error|Application error/.test(body)) {
    problem(`${what} shows an error page @ ${page.url()}`);
  }
  if (await page.locator("nextjs-portal").count()) {
    const overlay = await page
      .evaluate(() => document.querySelector("nextjs-portal")?.shadowRoot?.textContent ?? "")
      .catch(() => "");
    if (/Unhandled|Runtime Error|Console Error|Build Error/.test(overlay)) problem(`${what}: Next.js error overlay: ${overlay.slice(0, 200)}`);
  }
}

async function visit(page, url, what = url) {
  const res = await page.goto(url.startsWith("http") ? url : `${BASE}${url}`, { waitUntil: "domcontentloaded" });
  if (!res || res.status() >= 400) problem(`${what}: HTTP ${res?.status()} @ ${url}`);
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await assertRendered(page, what);
}

const visible = (loc, timeout = 4000) => loc.waitFor({ state: "visible", timeout }).then(
  () => true,
  () => false,
);

/** a few wide zig-zag strokes on a signature pad canvas */
async function drawStrokes(page, canvas) {
  const b = await canvas.boundingBox();
  check(b, "signature pad has no box");
  for (let s = 0; s < 3; s++) {
    const y0 = b.y + b.height * (0.3 + s * 0.2);
    await page.mouse.move(b.x + b.width * 0.15, y0);
    await page.mouse.down();
    for (let i = 1; i <= 16; i++) {
      await page.mouse.move(b.x + b.width * (0.15 + i * 0.045), y0 + (i % 2 ? -1 : 1) * b.height * 0.12, { steps: 3 });
    }
    await page.mouse.up();
  }
}

/** wizard step 1 / template use: name + 이메일 for every card (adds cards as needed) */
async function fillParticipants(page, people) {
  for (const [i, p] of people.entries()) {
    let cards = page.locator('main [role="group"]');
    if ((await cards.count()) <= i) {
      await page.getByRole("button", { name: /(서명자|열람자) 추가/ }).click();
      cards = page.locator('main [role="group"]');
    }
    const card = cards.nth(i);
    await card.getByRole("combobox", { name: "이름" }).fill(p.name);
    await page.keyboard.press("Escape");
    const delivery = card.getByRole("button", { name: "전송 수단 선택" });
    if (await visible(delivery, 1500)) {
      await delivery.click();
      await page.getByRole("menuitem", { name: "이메일" }).click();
    }
    await card.getByRole("textbox", { name: "이메일" }).fill(p.email);
    await page.keyboard.press("Escape");
  }
}

/** wizard step 2: a 사인·도장 + 텍스트 field for every participant (by name) */
async function placeFieldsForAll(page, names) {
  const canvases = page.locator("canvas");
  await canvases.first().waitFor({ state: "attached" });
  await page.waitForTimeout(1500); // let pdf.js paint the pages
  const boxes = await canvases.evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ x: r.x, y: r.y, w: r.width, h: r.height })));
  const pageBox = boxes.sort((a, b) => b.w * b.h - a.w * a.h)[0];
  for (const [i, name] of names.entries()) {
    const section = page.getByLabel("입력란 도구").locator("section").filter({ has: page.getByRole("button", { name, exact: false }) }).first();
    const header = section.getByRole("button", { name, exact: false }).first();
    if ((await header.getAttribute("aria-expanded")) !== "true") await header.click();
    const placeAt = async (tool, fx, fy) => {
      await section.getByRole("button", { name: tool, exact: true }).first().click();
      const x = pageBox.x + pageBox.w * fx;
      const y = pageBox.y + pageBox.h * fy;
      await page.mouse.move(x, y);
      await page.mouse.click(x, y);
      await page.waitForTimeout(150);
    };
    await placeAt("사인·도장", 0.3 + i * 0.35, 0.25);
    await placeAt("텍스트", 0.3 + i * 0.35, 0.45);
    await page.keyboard.press("Escape");
    const count = await section.getByLabel(/입력란 \d+개/).innerText().catch(() => "0");
    check(Number(count) >= 2, `${name}: expected 2 fields, got ${count}`);
  }
}

/** wizard step 3: 즉시 전송 → (라벨 미설정 → 이대로 전송) → 전송하기 → 전송 완료 */
async function sendFromStep3(page) {
  await page.getByRole("button", { name: "즉시 전송" }).click();
  const asIs = page.getByRole("button", { name: "이대로 전송" });
  if (await visible(asIs, 4000)) await asIs.click();
  await page.getByRole("button", { name: "전송하기" }).click();
  await page.waitForURL(/\/documents\/d\/completed/, { timeout: 60000 });
  await assertRendered(page, "전송 완료");
}

/** signer page: 본인 확인 건너뛰기 → 서명 시작하기 → 자동 입력 → 입력 완료 → 동의하고 서명합니다 */
async function signAsSigner(s, { expectAll }) {
  const skip = s.getByRole("button", { name: "본인 확인 건너뛰기 (미리보기)" });
  const start = s.getByRole("button", { name: /서명 시작하기|열람 시작하기/ });
  await Promise.race([skip.waitFor(), start.waitFor()]);
  await assertRendered(s, "signer page");
  if (await skip.isVisible()) {
    await skip.click();
    await start.waitFor();
  }
  await start.click();
  await s.getByRole("button", { name: "자동 입력 (미리보기)" }).click();
  await s.getByRole("button", { name: /입력 완료/ }).click();
  await s.getByRole("button", { name: "동의하고 서명합니다" }).click();
  await s.getByRole("heading", { name: expectAll ? "모든 서명 완료" : /서명 완료/ }).waitFor({ timeout: 60000 });
  await assertRendered(s, "signer done");
}

async function login(page, id, password) {
  await page.goto(`${BASE}/login`);
  await page.getByText("미리보기 모드").first().waitFor();
  await page.getByLabel("아이디").fill(id);
  await page.getByLabel("비밀번호", { exact: true }).fill(password);
  await page.getByRole("button", { name: "로그인" }).click();
  await page.waitForURL(/\/esign\/home/);
  await assertRendered(page, "home");
  return page.url().match(/workspaces\/([^/]+)/)[1];
}

/* --------------------------------------------------------------------------------------- run */

try {
  await ensureServer();
} catch (e) {
  stopServer();
  console.error(`✗ preview server: ${e.message}`);
  process.exit(1);
}

const browser = await chromium.launch({ channel: "chrome", headless: !HEADED });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ko-KR", acceptDownloads: true });
const page = await ctx.newPage();
page.setDefaultTimeout(20000);
watch(page, "requester");

const want = (name) => !ONLY || ONLY.split(",").includes(name);

try {
  step(`login with fake credentials (${FAKE.id})`);
  const wid = await login(page, FAKE.id, FAKE.password);
  const ws = (p) => `/workspaces/${wid}${p}`;

  if (want("crawl")) {
    step("서명 요청 sidebar pages");
    for (const p of [
      "/esign/home",
      "/esign/requests/request",
      "/esign/requests/templates",
      "/esign/requests/bulk-requests",
      "/esign/requests/links",
      "/esign/requests/signatures",
      "/esign/requests/approvals",
      "/esign/requests/approval-processes",
      "/esign/requests/custom-fields",
      "/esign/requests/address-book",
      "/esign/requests/editing-documents",
      "/esign/requests/drafts",
      "/templates",
    ]) await visit(page, ws(p));

    step("문서함 status filters");
    for (const s of [
      "all",
      "need_signing",
      "wait_for_signing",
      "need_viewing",
      "wait_for_viewing",
      "signing_completed",
      "viewing_completed",
      "rejected",
      "signing_cancelled",
      "request_cancelled",
      "draft",
      "on_modifying",
      "scheduled",
    ]) await visit(page, ws(`/esign/documents/documents?status=${s}`), `문서함 ${s}`);
    await visit(page, ws("/esign/documents/data-export"));
    await visit(page, ws("/esign/documents/reminders"));

    step("document viewer (문서함 row panel → 내용 확인)");
    await visit(page, ws("/esign/documents/documents?status=signing_completed"));
    // the row title opens the panel; its "내용 확인" link leads to the read-only viewer
    await page.locator('[role="table"] [role="button"][aria-expanded]').first().click();
    await page.getByRole("link", { name: "내용 확인", exact: true }).first().click();
    await page.waitForURL(/\/documents\/[0-9a-f-]{36}$/);
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await assertRendered(page, "viewer");
    await page.getByRole("link", { name: "완료 문서 다운로드" }).waitFor();

    step("통합 설정 pages");
    for (const p of [
      "/settings/workspace/info",
      "/settings/workspace/members",
      "/settings/workspace/groups",
      "/settings/workspace/roles",
      "/settings/workspace/security",
      "/settings/workspace/audit-log",
      "/settings/esign/automatic-sharing",
      "/settings/esign/branding",
      "/settings/esign/certified-stamp",
      "/settings/esign/document-permissions",
      "/settings/esign/receiving-control",
      "/settings/personal/member",
      "/settings/personal/password",
      "/settings/personal/notifications",
    ]) await visit(page, ws(p));
    await visit(page, "/dev/mailbox");
  }

  if (want("signatures")) {
    step("사인·도장: register a drawn signature");
    await visit(page, ws("/esign/requests/signatures"));
    const before = await page.getByRole("button", { name: /메뉴$/ }).count();
    await page.getByRole("button", { name: "사인 등록" }).click();
    const drawTab = page.getByRole("tab", { name: "그리기" });
    if (await visible(drawTab, 2000)) await drawTab.click();
    const pad = page.locator('[role="tabpanel"][aria-label="그리기"] canvas');
    await pad.waitFor();
    await drawStrokes(page, pad);
    await page.getByRole("button", { name: "입력하기" }).click();
    await page.getByText("사인을 등록했습니다.").waitFor();
    await page.waitForTimeout(500);
    const after = await page.getByRole("button", { name: /메뉴$/ }).count();
    check(after > before, `사인 list did not grow (${before} → ${after})`);
  }

  if (want("wizard")) {
    step("request wizard: upload");
    const title = `미리보기 E2E ${STAMP}`;
    await visit(page, ws("/documents/d/upload"));
    await page.locator('input[type="file"]').setInputFiles(await makePdf(title));
    await page.getByText(title, { exact: false }).first().waitFor();
    await page.getByRole("button", { name: "다음으로" }).click();
    await page.waitForURL(/\/steps\/1/);
    await assertRendered(page, "step 1");

    step("request wizard: 2 external signers, sequential");
    const signers = [
      { name: "가상 서명자 하나", email: `one.${STAMP}@example.com` },
      { name: "가상 서명자 둘", email: `two.${STAMP}@example.com` },
    ];
    await page.getByRole("tab", { name: "순서대로" }).click();
    await fillParticipants(page, signers);
    await page.getByRole("button", { name: "다음으로" }).click();
    await page.waitForURL(/\/steps\/2/);
    await assertRendered(page, "step 2");

    step("request wizard: signature + text field for each signer");
    await placeFieldsForAll(page, signers.map((s) => s.name));
    await page.getByRole("button", { name: "다음으로" }).click();
    await page.waitForURL(/\/steps\/3/);
    await assertRendered(page, "step 3");

    step("request wizard: 즉시 전송 → 라벨 미설정 → 전송하기");
    await sendFromStep3(page);
    const docId = new URL(page.url()).searchParams.get("doc");
    check(docId, "전송 완료 page has no ?doc=");
    await page.getByText("전송 완료", { exact: false }).first().waitFor();

    step("전송 완료: open the first signer page (미리보기 box)");
    const box = page.getByText("미리보기 전용", { exact: false }).first();
    await box.waitFor();
    const [signerPage] = await Promise.all([ctx.waitForEvent("page"), page.getByRole("link", { name: `${signers[0].name} 서명자 화면 열기` }).click()]);
    watch(signerPage, "signer");
    signerPage.setDefaultTimeout(30000);
    await signerPage.waitForLoadState("domcontentloaded");
    await signAsSigner(signerPage, { expectAll: false });
    await signerPage.close();

    step("전송 완료: 모든 서명자 서명 완료 처리 (미리보기) for the rest");
    await page.reload();
    await page.getByRole("button", { name: "모든 서명자 서명 완료 처리 (미리보기)" }).click();
    await page.getByText("서명 완료 처리되었습니다 (미리보기)").waitFor({ timeout: 60000 });
    const viewerBtn = page.getByRole("link", { name: "완료 문서 보기" });
    await viewerBtn.waitFor({ timeout: 30000 });

    step("문서함 shows 완료");
    await visit(page, ws("/esign/documents/documents?status=signing_completed"), "문서함 완료");
    const row = page.locator("div.relative").filter({ hasText: title }).first();
    await row.waitFor();
    check(/완료/.test(await row.innerText()), "문서함 row is not 완료");

    step("viewer shows the signed values");
    await visit(page, ws(`/documents/${docId}`), "viewer");
    await page.getByText("미리보기 입력").first().waitFor();
    const signatureImgs = await page.locator("img[src^='data:image'], img[src*='/api/preview/storage']").count();
    check(signatureImgs >= 1, "viewer shows no signature image");

    step("completed PDF download");
    const pdf = await page.request.get(`${BASE}/api/documents/${docId}/download?type=completed`);
    check(pdf.status() === 200, `completed download HTTP ${pdf.status()}`);
    check((pdf.headers()["content-type"] ?? "").includes("application/pdf"), `completed download content-type ${pdf.headers()["content-type"]}`);
    const bytes = await pdf.body();
    check(bytes.subarray(0, 5).toString() === "%PDF-", "completed download is not a PDF");
    const original = await page.request.get(`${BASE}/api/documents/${docId}/download?type=original`);
    check(original.status() === 200 && (original.headers()["content-type"] ?? "").includes("application/pdf"), "original download failed");

    step("/dev/mailbox lists the sent mails");
    await visit(page, "/dev/mailbox");
    for (const s of signers) {
      await page.getByText(s.email).first().waitFor({ timeout: 10000 }).catch(() => problem(`mailbox has no mail to ${s.email}`));
    }
    const body = await page.locator("body").innerText();
    check(/\[서명요청\]/.test(body), "mailbox has no [서명요청] mail");
    check(/\[서명완료\]/.test(body), "mailbox has no [서명완료] mail");
  }

  const templateTitle = `미리보기 템플릿 ${STAMP}`;
  const roleName = "계약 상대방";
  if (want("templates")) {
    step("템플릿: create from an upload");
    await visit(page, ws("/esign/requests/templates"));
    await page.getByRole("link", { name: /템플릿 등록|새 템플릿|템플릿 만들기/ }).first().click();
    await page.waitForURL(/\/templates\/new/);
    await assertRendered(page, "template new");
    await page.locator('input[type="file"]').setInputFiles(await makePdf(templateTitle));
    await page.getByText(templateTitle, { exact: false }).first().waitFor();
    await page.getByRole("button", { name: "다음으로" }).click();
    await page.getByRole("heading", { name: "역할 설정" }).waitFor();
    if (!(await page.locator('main [role="group"], [role="group"][aria-label^="서명자"]').count())) await page.getByRole("button", { name: /서명자 추가/ }).click();
    await page.getByLabel("역할 이름").first().fill(roleName);
    await page.getByRole("button", { name: "다음으로" }).click();
    await placeFieldsForAll(page, [roleName]);
    await page.getByRole("button", { name: "다음으로" }).click();
    await page.getByRole("heading", { name: "템플릿 정보" }).waitFor();
    await page.getByLabel("템플릿 제목").fill(templateTitle);
    await page.getByRole("button", { name: "등록하기" }).click();
    await page.waitForURL(/\/esign\/requests\/templates/, { timeout: 60000 });
    await page.getByText(templateTitle).first().waitFor();
    await assertRendered(page, "templates list");

    step("템플릿: use it for a sign request");
    await page.getByRole("button", { name: `${templateTitle} 추가 메뉴` }).click();
    await page.getByRole("menuitem", { name: "사용하기" }).click();
    await page.waitForURL(/\/steps\/1/, { timeout: 60000 });
    await assertRendered(page, "template → step 1");
    await fillParticipants(page, [{ name: "템플릿 수신자", email: `tpl.${STAMP}@example.com` }]);
    await page.getByRole("button", { name: "다음으로" }).click();
    await page.waitForURL(/\/steps\/2/);
    await page.waitForTimeout(1000);
    const fieldCount = await page.getByLabel(/입력란 \d+개/).first().innerText();
    check(Number(fieldCount) >= 2, `template fields were not copied (${fieldCount})`);
    await page.getByRole("button", { name: "다음으로" }).click();
    await page.waitForURL(/\/steps\/3/);
    await sendFromStep3(page);
  }

  if (want("bulk")) {
    step("대량전송: 2 recipients");
    await visit(page, ws("/esign/requests/bulk-requests"));
    await page.getByRole("button", { name: "템플릿으로 대량전송" }).click();
    const radio = page.getByRole("radio", { name: new RegExp(templateTitle) });
    if (await visible(radio, 4000)) await radio.click();
    else await page.getByRole("radiogroup", { name: "템플릿 선택" }).getByRole("radio").filter({ hasNot: page.locator("[aria-disabled=true]") }).first().click();
    await page.getByRole("dialog").getByRole("button", { name: "다음", exact: true }).click();
    const bulkTitle = `미리보기 대량전송 ${STAMP}`;
    await page.getByPlaceholder("대량전송 제목").fill(bulkTitle);
    await page.getByLabel("1번째 수신자 이름").fill("대량 수신자 하나");
    await page.getByLabel("1번째 수신자 이메일").fill(`bulk1.${STAMP}@example.com`);
    await page.getByRole("button", { name: "수신자 추가" }).click();
    await page.getByLabel("2번째 수신자 이름").fill("대량 수신자 둘");
    await page.getByLabel("2번째 수신자 이메일").fill(`bulk2.${STAMP}@example.com`);
    await page.getByRole("dialog").getByRole("button", { name: "다음", exact: true }).click();
    await page.getByRole("button", { name: "2명에게 전송하기" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "확인", exact: true }).waitFor({ timeout: 60000 });
    const status = await page.getByRole("status").innerText();
    check(/2/.test(status) && !/실패\s*[1-9]/.test(status), `bulk progress: ${status.replace(/\s+/g, " ")}`);
    await page.getByRole("dialog").getByRole("button", { name: "확인", exact: true }).click();
    await page.getByText(bulkTitle).first().waitFor();
    await visit(page, ws("/esign/documents/documents?status=wait_for_signing"), "문서함 대기");
    check((await page.getByText(bulkTitle).count()) >= 2, "bulk documents are not in 문서함");
  }

  if (want("links")) {
    step("링크서명: create");
    await visit(page, ws("/esign/requests/links"));
    await page.getByRole("button", { name: "링크서명 시작" }).click();
    const radio = page.getByRole("radio", { name: new RegExp(templateTitle) });
    if (await visible(radio, 4000)) await radio.click();
    else await page.getByRole("radiogroup").getByRole("radio").first().click();
    await page.getByRole("dialog").getByRole("button", { name: "다음", exact: true }).click();
    const linkTitle = `미리보기 링크 ${STAMP}`;
    await page.getByPlaceholder("링크 제목").fill(linkTitle);
    await page.getByRole("button", { name: "링크 만들기" }).click();
    const urlBox = page.getByLabel("링크 주소");
    await urlBox.waitFor({ timeout: 30000 });
    const linkUrl = await urlBox.inputValue();
    check(/\/link\/[^/]+$/.test(linkUrl), `link url looks wrong: ${linkUrl}`);
    await page.getByRole("dialog").getByRole("button", { name: "확인", exact: true }).click();

    step("링크서명: open the public page (signed out) and sign");
    const pub = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "ko-KR" });
    const lp = await pub.newPage();
    lp.setDefaultTimeout(30000);
    watch(lp, "link signer");
    await visit(lp, linkUrl.replace(/^https?:\/\/[^/]+/, BASE), "public link page");
    await lp.getByPlaceholder("이름").fill("링크 서명자");
    await lp.getByPlaceholder("이메일 주소").fill(`link.${STAMP}@example.com`);
    await lp.getByRole("checkbox").first().check({ force: true }).catch(async () => lp.getByText("[필수] 개인정보 수집·이용 동의").click());
    await lp.getByRole("button", { name: /시작하기/ }).click();
    await lp.waitForURL(/\/sign\//, { timeout: 60000 });
    await signAsSigner(lp, { expectAll: true });
    await pub.close();
  }

  if (want("reject")) {
    step("서명 거절: signer opens /sign/<token>?action=reject (문서함 거절 entry) and rejects");
    await visit(page, ws("/esign/documents/documents?status=wait_for_signing"), "문서함 대기");
    await page.locator('[role="table"] [role="button"][aria-expanded]').first().click();
    const turn = page.locator("li").filter({ hasText: "서명 차례" }).filter({ has: page.getByRole("link", { name: /서명자 화면 열기/ }) });
    const href = await turn.first().getByRole("link").first().getAttribute("href");
    check(href?.startsWith("/sign/"), `no signer link in the row panel (${href})`);
    const rc = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "ko-KR" });
    const rp = await rc.newPage();
    rp.setDefaultTimeout(30000);
    watch(rp, "rejecting signer");
    await visit(rp, href, "signer page");
    await rp.getByRole("button", { name: "본인 확인 건너뛰기 (미리보기)" }).click();
    await rp.getByRole("button", { name: /서명 시작하기|열람 시작하기/ }).waitFor();
    // the reject dialog is open on the first render: must hydrate without a mismatch
    await visit(rp, `${href}?action=reject`, "signer reject entry");
    const dialog = rp.getByRole("dialog");
    await dialog.locator("textarea").fill("미리보기 E2E 거절 사유입니다.");
    await dialog.getByRole("button", { name: /거절/ }).last().click();
    await rp.getByRole("heading", { name: "서명을 거절했습니다." }).waitFor();
    await rc.close();
    await visit(page, ws("/esign/documents/documents?status=rejected"), "문서함 거절");
  }

  if (want("approvals")) {
    step("내부결재: create (approver 이서연)");
    await visit(page, ws("/esign/requests/approvals"));
    await visit(page, ws("/esign/requests/approvals/new"));
    await page.locator('input[type="file"]').setInputFiles(await makePdf(`approval-${STAMP}`));
    await page.getByText("파일 변경").waitFor({ timeout: 30000 });
    const approvalTitle = `미리보기 기안 ${STAMP}`;
    await page.getByPlaceholder("기안 제목을 입력하세요").fill(approvalTitle);
    const sel = page.getByLabel("1번째 결재자", { exact: true });
    const value = await sel.locator("option").filter({ hasText: "이서연" }).first().getAttribute("value");
    await sel.selectOption(value);
    await page.getByRole("button", { name: "결재 요청" }).click();
    await page.waitForURL(/\/approvals\/[0-9a-f-]{36}$/, { timeout: 60000 });
    await assertRendered(page, "approval detail");
    const approvalUrl = page.url();

    step("내부결재: log out, log in as seoyeon and approve");
    await visit(page, ws("/esign/home"));
    await page.getByRole("button", { name: "내 계정" }).click();
    await page.getByRole("button", { name: "로그아웃" }).or(page.getByRole("menuitem", { name: "로그아웃" })).first().click();
    await page.waitForURL(/\/login/);
    await login(page, "seoyeon", "anything");
    await visit(page, approvalUrl, "approval detail (seoyeon)");
    await page.getByRole("button", { name: "승인", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "승인", exact: true }).click();
    await page.getByText(/승인했습니다|결재 완료|승인 완료/).first().waitFor({ timeout: 30000 });
    await assertRendered(page, "approval approved");
  }
} catch (e) {
  problem(`FAILED: ${String(e.message).split("\n")[0]}`);
  const dir = mkdtempSync(path.join(tmpdir(), "e2e-preview-fail-"));
  for (const [i, p] of browser.contexts().flatMap((c) => c.pages()).entries()) {
    const file = path.join(dir, `page-${i}.png`);
    await p.screenshot({ path: file, fullPage: false }).catch(() => {});
    const toasts = await p.locator("[data-sonner-toast]").allInnerTexts().catch(() => []);
    console.error(`  page ${i}: ${p.url()}\n    screenshot: ${file}${toasts.length ? `\n    toasts: ${toasts.join(" | ")}` : ""}`);
  }
} finally {
  await browser.close();
}

const serverLog = ownServer ? ownServer.output : LOG && existsSync(LOG) ? readFileSync(LOG, "utf8").slice(logStart) : null;
stopServer();
current = "server log";
if (serverLog === null) console.log("  (server log not checked — pass --log <file> with the output of the running preview server)");
else {
  for (const line of serverLog.split(/\r?\n/)) {
    // a request the browser dropped (page closed / navigated) is not an app error
    if (/aborted|ECONNRESET/.test(line)) continue;
    if (/\[preview\]/.test(line) && /warn|unknown|not supported|PGRST|42P01|42703|failed|error/i.test(line)) problem(line.trim().slice(0, 300));
    else if (/⨯|Error:|TypeError|ReferenceError|Hydration failed/.test(line)) problem(line.trim().slice(0, 300));
  }
}

if (problems.length) {
  console.error(`\n✗ preview e2e: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exitCode = 1;
} else console.log("\n✓ preview e2e passed");
