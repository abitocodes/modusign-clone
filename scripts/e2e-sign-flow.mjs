// End-to-end smoke test of the core flow against a running dev server + local Supabase + Mailpit:
//   login → upload → participants → field placement → send → (Mailpit) → signer identity check →
//   sign (사인 만들기) → text → consent → 모든 서명 완료 → completion mail with 2 attachments.
// Usage:  npm run dev   (in another terminal, with .env.local pointing at the LOCAL Supabase)
//         node scripts/e2e-sign-flow.mjs [--base http://localhost:3000] [--headed]
// Uses the system Google Chrome through playwright-core (no browser download).
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { PDFDocument, StandardFonts } from "pdf-lib";
import { chromium } from "playwright-core";

const args = process.argv.slice(2);
const BASE = args.includes("--base") ? args[args.indexOf("--base") + 1] : "http://localhost:3000";
const MAILPIT = "http://127.0.0.1:54324";
const HEADED = args.includes("--headed");
const LOGIN = { id: "admin", password: "Admin1234!" }; // local seed account (scripts/seed.mjs)
const signerEmail = `e2e+${Date.now()}@example.com`;

const step = (m) => console.log(`• ${m}`);

async function samplePdf() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("E2E test document", { x: 60, y: 760, size: 22, font });
  page.drawText("Signature:", { x: 60, y: 600, size: 12, font });
  const dir = mkdtempSync(path.join(tmpdir(), "e2e-"));
  const file = path.join(dir, "e2e-test.pdf");
  writeFileSync(file, await doc.save());
  return file;
}

async function waitForMail(to, subjectPart, timeoutMs = 30000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`);
    if (res.ok) {
      const { messages } = await res.json();
      const m = messages?.find((x) => x.Subject.includes(subjectPart));
      if (m) return m;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`mail "${subjectPart}" to ${to} not received`);
}

const browser = await chromium.launch({ channel: "chrome", headless: !HEADED });
try {
  // ---------------------------------------------------------------- requester
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ko-KR" });
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);

  step("login");
  await page.goto(`${BASE}/login`);
  await page.getByLabel("아이디").fill(LOGIN.id);
  await page.getByLabel("비밀번호", { exact: true }).fill(LOGIN.password);
  await page.getByRole("button", { name: "로그인" }).click();
  await page.waitForURL(/\/esign\/home/);
  const wid = page.url().match(/workspaces\/([^/]+)/)[1];

  step("upload");
  await page.goto(`${BASE}/workspaces/${wid}/documents/d/upload`);
  await page.locator('input[type="file"]').setInputFiles(await samplePdf());
  await page.getByText("e2e-test", { exact: false }).first().waitFor();
  await page.getByRole("button", { name: "다음으로" }).click();
  await page.waitForURL(/\/steps\/1/);

  step("participants");
  await page.getByRole("combobox", { name: "이름" }).fill("E2E 서명자");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "전송 수단 선택" }).click();
  await page.getByRole("menuitem", { name: "이메일" }).click();
  await page.getByRole("textbox", { name: "이메일" }).fill(signerEmail);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "다음으로" }).click();
  await page.waitForURL(/\/steps\/2/);

  step("fields");
  const canvases = page.locator("canvas");
  await canvases.first().waitFor({ state: "attached" });
  await page.waitForTimeout(1500); // let pdf.js paint the pages
  const boxes = await canvases.evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ x: r.x, y: r.y, w: r.width, h: r.height })));
  const pageBox = boxes.sort((a, b) => b.w - a.w)[0];
  const placeAt = async (tool, fx, fy) => {
    await page.getByRole("button", { name: tool, exact: true }).first().click();
    const x = pageBox.x + pageBox.w * fx;
    const y = pageBox.y + pageBox.h * fy;
    await page.mouse.move(x, y);
    await page.mouse.click(x, y);
  };
  await placeAt("사인·도장", 0.3, 0.25);
  await placeAt("텍스트", 0.3, 0.4);
  await page.getByRole("button", { name: "다음으로" }).click();
  await page.waitForURL(/\/steps\/3/);

  step("send");
  await page.getByRole("button", { name: "즉시 전송" }).click();
  const asIs = page.getByRole("button", { name: "이대로 전송" });
  if (await asIs.waitFor({ timeout: 4000 }).then(() => true, () => false)) await asIs.click();
  await page.getByRole("button", { name: "전송하기" }).click();
  await page.waitForURL(/\/documents\/d\/completed/);

  step("mail");
  const req = await waitForMail(signerEmail, "[서명요청]");
  const full = await (await fetch(`${MAILPIT}/api/v1/message/${req.ID}`)).json();
  const link = full.HTML.match(/href="(http[^"]*\/sign\/[^"]+)"/)[1].replace(/^https?:\/\/[^/]+/, BASE);

  // ------------------------------------------------------------------- signer
  step("signer: identity check");
  const sctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ko-KR" });
  const s = await sctx.newPage();
  s.setDefaultTimeout(30000);
  await s.goto(link);
  await s.getByPlaceholder("이메일 주소").fill(signerEmail);
  await s.getByRole("button", { name: "다음으로" }).click();
  await s.getByRole("button", { name: /서명 시작하기/ }).click();

  step("signer: signature");
  await s.getByRole("button", { name: /\(필수\) 사인·도장/ }).first().click();
  const pickSign = s.getByRole("button", { name: "사인", exact: true });
  if (await pickSign.waitFor({ timeout: 4000 }).then(() => true, () => false)) await pickSign.click();
  await s.getByRole("tab", { name: "사인 만들기" }).click();
  await s.locator('[role="tabpanel"] button img, [role="tabpanel"] button canvas').first().waitFor();
  await s.locator('[role="tabpanel"] button:has(img), [role="tabpanel"] button:has(canvas)').first().click();
  await s.getByRole("button", { name: "입력하기" }).click();

  step("signer: text");
  await s.getByRole("textbox", { name: /\(필수\) 텍스트/ }).fill("E2E 입력");
  await s.getByRole("button", { name: /입력 완료/ }).click();
  await s.getByRole("button", { name: "동의하고 서명합니다" }).click();
  await s.getByText("모든 서명 완료").waitFor({ timeout: 60000 });

  step("completion mail");
  const done = await waitForMail(signerEmail, "[서명완료]", 60000);
  if ((done.Attachments ?? 0) < 2) throw new Error(`completion mail has ${done.Attachments} attachments (expected 2)`);

  console.log(`\n✓ E2E passed (signer ${signerEmail})`);
} catch (e) {
  console.error("\n✗ E2E failed:", e.message.split("\n")[0]);
  const dir = mkdtempSync(path.join(tmpdir(), "e2e-fail-"));
  for (const [i, p] of browser.contexts().flatMap((c) => c.pages()).entries()) {
    const file = path.join(dir, `page-${i}.png`);
    await p.screenshot({ path: file, fullPage: false }).catch(() => {});
    const toasts = await p.locator("[data-sonner-toast]").allInnerTexts().catch(() => []);
    console.error(`  page ${i}: ${p.url()}\n    screenshot: ${file}${toasts.length ? `\n    toasts: ${toasts.join(" | ")}` : ""}`);
  }
  process.exitCode = 1;
} finally {
  await browser.close();
}
