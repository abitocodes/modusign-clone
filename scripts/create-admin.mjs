// Creates the first administrator (owner) account on a Supabase project.
// Usage:
//   node scripts/create-admin.mjs --env .env.production.local --email you@company.com --username admin --name 관리자 [--company 우리회사]
// A strong random password is generated and written to ./admin-credentials.local.txt (git-ignored).
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => (cur.startsWith("--") ? [...acc, [cur.slice(2), arr[i + 1]]] : acc), []),
);
const envFile = args.env ?? ".env.local";
const env = Object.fromEntries(
  readFileSync(envFile, "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]),
);
if (!args.email) {
  console.error("--email is required");
  process.exit(1);
}

const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#%^*";
const bytes = randomBytes(20);
const password = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { error } = await admin.auth.admin.createUser({
  email: args.email,
  password,
  email_confirm: true,
  user_metadata: {
    name: args.name ?? "관리자",
    username: (args.username ?? "admin").toLowerCase(),
    role: "owner",
    company: args.company ?? "우리회사",
  },
});
if (error) {
  console.error("✗", error.message);
  process.exit(1);
}
writeFileSync(
  "admin-credentials.local.txt",
  `Supabase: ${env.NEXT_PUBLIC_SUPABASE_URL}\n아이디: ${(args.username ?? "admin").toLowerCase()} (또는 ${args.email})\n초기 비밀번호: ${password}\n※ 첫 로그인 후 통합 설정 > 개인 설정 > 비밀번호 변경에서 바꿔 주세요.\n`,
);
console.log("✓ admin created:", args.email, "→ credentials written to admin-credentials.local.txt");
