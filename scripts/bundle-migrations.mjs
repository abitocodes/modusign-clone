// Concatenates supabase/migrations/*.sql (in order) into one file that can be pasted into
// the Supabase Dashboard → SQL Editor of a fresh project.
// Usage: node scripts/bundle-migrations.mjs [out=supabase/bundle.sql]
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

const dir = "supabase/migrations";
const out = process.argv[2] ?? "supabase/bundle.sql";
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const sql = files
  .map((f) => `-- ===================================================================\n-- ${f}\n-- ===================================================================\n${readFileSync(`${dir}/${f}`, "utf8").trim()}\n`)
  .join("\n");
writeFileSync(out, sql);
console.log(`bundled ${files.length} migrations → ${out} (${sql.length} chars)`);
