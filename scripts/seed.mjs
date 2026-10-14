// Seeds the LOCAL Supabase with an admin employee account and a couple of sample employees.
// Usage: npm run seed                              (reads .env.local)
//        node scripts/seed.mjs --env .env.supabase-local.local
// The accounts use well-known test passwords, so the script refuses to run against a remote project.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const envArg = process.argv.indexOf("--env");
const envFile = envArg > -1 ? process.argv[envArg + 1] : new URL("../.env.local", import.meta.url);
const env = Object.fromEntries(
  readFileSync(envFile, "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]),
);

const host = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname;
if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(host)) {
  console.error(`✗ ${host} is not a local Supabase — refusing to create test accounts with known passwords there.`);
  console.error("  Use --env <file> pointing at the local stack (npx supabase start), or create-admin.mjs for a real project.");
  process.exit(1);
}

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Local development test accounts (not real credentials).
const USERS = [
  { email: "admin@company.test", password: "Admin1234!", name: "관리자", username: "admin", role: "owner", company: "우리회사", department: "경영지원팀", position: "팀장" },
  { email: "kim@company.test", password: "Test1234!", name: "김민수", username: "minsu", role: "member", department: "영업팀", position: "대리" },
  { email: "lee@company.test", password: "Test1234!", name: "이서연", username: "seoyeon", role: "admin", department: "법무팀", position: "과장" },
];

for (const u of USERS) {
  const { error } = await admin.auth.admin.createUser({
    email: u.email,
    password: u.password,
    email_confirm: true,
    user_metadata: { name: u.name, username: u.username, role: u.role, company: u.company, department: u.department, position: u.position },
  });
  if (error && !/already/i.test(error.message)) {
    console.error("✗", u.email, error.message);
    process.exitCode = 1;
  } else {
    console.log(error ? "• exists " : "✓ created", u.username, `(${u.email})`);
  }
}
