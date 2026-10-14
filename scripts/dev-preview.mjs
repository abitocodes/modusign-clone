#!/usr/bin/env node
/**
 * npm run dev:preview — the whole app on an in-memory mock backend (no Supabase, no Docker, no
 * SMTP), for clicking through every screen with demo data. See src/lib/preview/DESIGN.md.
 *
 *  * port 3100 (PREVIEW_PORT to change), build output in .next-preview — runs side by side with
 *    `npm run dev` (port 3000, .next)
 *  * the Supabase URL points at a closed local port and SMTP is disabled, so an accidental real
 *    client fails fast instead of reaching a real project; .env files cannot override these
 *    (variables already in the environment win)
 */
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = process.env.PREVIEW_PORT || "3100";

const env = {
  ...process.env,
  NEXT_PUBLIC_PREVIEW_MODE: "1",
  NEXT_DIST_DIR: ".next-preview",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:9",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "preview",
  SUPABASE_SERVICE_ROLE_KEY: "preview",
  SIGN_COOKIE_SECRET: "preview-only-secret-preview-only-secret",
  SMTP_HOST: "",
  NEXT_PUBLIC_APP_URL: `http://localhost:${port}`,
};
// `next dev` must run as development (PREVIEW is always off in production builds)
delete env.NODE_ENV;

const win = process.platform === "win32";
const bin = path.join(root, "node_modules", ".bin", win ? "next.cmd" : "next");
const args = ["dev", "--port", port, ...process.argv.slice(2)];

console.log(`\n  미리보기 모드 (mock backend) → http://localhost:${port}\n  아무 아이디·비밀번호로 로그인할 수 있습니다.\n`);

const child = spawn(win ? `"${bin}"` : bin, args, { cwd: root, env, stdio: "inherit", shell: win });

let exited = false;
/** Windows: the shell (cmd.exe) does not pass signals on, so the whole process tree is ended */
const stopTree = () => {
  if (exited || !child.pid) return;
  if (win) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else child.kill("SIGTERM");
};
const forward = (signal) => {
  if (exited) return;
  if (win) stopTree();
  else child.kill(signal);
};
process.on("SIGINT", () => forward("SIGINT"));
process.on("SIGTERM", () => forward("SIGTERM"));
process.on("SIGHUP", () => forward("SIGHUP"));
process.on("exit", stopTree);
child.on("exit", (code, signal) => {
  exited = true;
  process.exit(code ?? (signal ? 1 : 0));
});
child.on("error", (e) => {
  console.error("[dev:preview] could not start next dev:", e.message);
  process.exit(1);
});
