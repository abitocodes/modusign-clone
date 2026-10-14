#!/usr/bin/env node
/**
 * Runs the preview engine self-test (src/lib/preview/engine/selftest.ts) under plain Node 22
 * (type stripping), without Next.js, Supabase or any network access.
 *
 *   node scripts/preview-engine-selftest.mjs            # real RPC registry (src/lib/preview/rpc)
 *   PREVIEW_SELFTEST_STUB_RPC=1 node scripts/…          # empty RPC registry stub
 *
 * A module resolve hook adds the ".ts" / "/index.ts" extensions that TypeScript-style imports omit,
 * maps "@/…" to src/ and stubs "server-only".
 */
import { spawnSync } from "node:child_process";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

if (!process.execArgv.some((a) => a.startsWith("--experimental-strip-types") || a.startsWith("--experimental-transform-types"))) {
  const r = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", ...process.execArgv, fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: "inherit", cwd: root, env: process.env },
  );
  process.exit(r.status ?? 1);
}

const hooks = `
const SRC = ${JSON.stringify(pathToFileURL(path.join(root, "src")).href + "/")};
const STUB_RPC = ${JSON.stringify(process.env.PREVIEW_SELFTEST_STUB_RPC === "1")};
export async function resolve(specifier, context, next) {
  if (specifier === "server-only" || specifier === "client-only") {
    return { url: "data:text/javascript,export {};", shortCircuit: true };
  }
  if (STUB_RPC && specifier === "../rpc" && context.parentURL && /\\/preview\\/engine\\//.test(context.parentURL)) {
    return { url: "data:text/javascript,export const RPCS = {};", shortCircuit: true };
  }
  if (specifier.startsWith("@/")) specifier = new URL(specifier.slice(2), SRC).href;
  const relative = specifier.startsWith("./") || specifier.startsWith("../") || specifier.startsWith("file:");
  try {
    return await next(specifier, context);
  } catch (err) {
    if (!relative || /\\.[cm]?[jt]sx?$/.test(specifier)) throw err;
    for (const suffix of [".ts", ".tsx", "/index.ts", "/index.tsx"]) {
      try {
        return await next(specifier + suffix, context);
      } catch {}
    }
    throw err;
  }
}
`;
register("data:text/javascript," + encodeURIComponent(hooks), import.meta.url);

const target = pathToFileURL(path.join(root, "src", "lib", "preview", "engine", "selftest.ts")).href;
const mod = await import(target);
const ok = await mod.runSelfTest({ verbose: process.argv.includes("--verbose") });
process.exit(ok ? 0 : 1);
