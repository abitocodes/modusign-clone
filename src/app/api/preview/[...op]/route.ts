import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { PREVIEW } from "@/lib/preview/flag";
import { ensureSeeded } from "@/lib/preview/seed";
import { createPreviewServerClient, executePreviewOp, nextCookieAdapter } from "@/lib/preview/server-client";
import { verifySignedStorageQuery } from "@/lib/preview/storage";
import { getObject } from "@/lib/preview/storage-state";
import type { DataOp } from "@/lib/preview/types";

/**
 * Preview mode (`npm run dev:preview`) only — the mock backend's HTTP side (src/lib/preview/DESIGN.md):
 *   POST /api/preview/data               serialised from()/rpc() call of the browser client
 *   POST /api/preview/storage/upload     FormData upload · /download · /call (other bucket methods)
 *   GET  /api/preview/storage?bucket&path&exp&sig[&download]   signed object URL
 *   POST /api/preview/auth/<method>      getUser · getSession · signInWithPassword · signOut · updateUser · refreshSession
 * Every request runs with the cookie session. Anything else, and every request outside preview
 * mode, is a 404.
 */
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ op: string[] }> };

const notFound = () => new NextResponse("Not found", { status: 404 });
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

async function userClient() {
  return createPreviewServerClient(nextCookieAdapter(await cookies()));
}

function errorJson(e: unknown) {
  const err = e as { name?: string; message?: string; status?: number; statusCode?: string; code?: string } | null;
  return { name: err?.name ?? "Error", message: err?.message ?? String(e), status: err?.status ?? 500, statusCode: err?.statusCode, code: err?.code };
}

/** RFC 6266 Content-Disposition with an ASCII fallback */
function disposition(kind: "inline" | "attachment", name: string) {
  const fallback = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_") || "download";
  return `${kind}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export async function GET(request: NextRequest, { params }: Ctx) {
  if (!PREVIEW) return notFound();
  const { op } = await params;
  if (op.length !== 1 || op[0] !== "storage") return notFound();

  const ref = verifySignedStorageQuery(request.nextUrl.searchParams);
  if ("error" in ref) return json({ statusCode: String(ref.status), error: "InvalidSignature", message: ref.error }, ref.status);
  const db = await ensureSeeded();
  let obj;
  try {
    obj = getObject(db, ref.bucket, ref.path);
  } catch {
    obj = null;
  }
  if (!obj) return json({ statusCode: "404", error: "not_found", message: "Object not found" }, 404);

  const headers = new Headers({
    "Content-Type": obj.contentType,
    "Content-Length": String(obj.bytes.byteLength),
    "Cache-Control": "private, no-store",
    "Access-Control-Allow-Origin": "*",
    "Last-Modified": new Date(obj.updated_at).toUTCString(),
  });
  if (ref.download !== null) headers.set("Content-Disposition", disposition("attachment", ref.download || obj.name.split("/").pop() || "download"));
  return new NextResponse(obj.bytes as BodyInit, { status: 200, headers });
}

const AUTH_METHODS = new Set(["getUser", "getSession", "signInWithPassword", "signOut", "updateUser", "refreshSession"]);
const STORAGE_METHODS = new Set(["createSignedUrl", "createSignedUrls", "remove", "copy", "move", "list", "exists", "info"]);

export async function POST(request: NextRequest, { params }: Ctx) {
  if (!PREVIEW) return notFound();
  const { op } = await params;
  const [area, action] = op;

  if (area === "data" && op.length === 1) {
    let body: DataOp;
    try {
      body = (await request.json()) as DataOp;
    } catch {
      return json({ data: null, error: { message: "malformed request", code: "PGRST100", details: null, hint: null }, count: null, status: 400, statusText: "Bad Request" });
    }
    return json(await executePreviewOp(body, nextCookieAdapter(await cookies())));
  }

  if (area === "auth" && op.length === 2 && AUTH_METHODS.has(action)) {
    const client = await userClient();
    let args: unknown[] = [];
    try {
      const body = (await request.json()) as { args?: unknown[] } | null;
      args = Array.isArray(body?.args) ? body.args : [];
    } catch {
      // no body
    }
    const fn = client.auth[action as "getUser"] as (...a: unknown[]) => Promise<{ data?: unknown; error: unknown }>;
    const res = await fn(...args);
    return json({ data: res.data ?? null, error: res.error ? errorJson(res.error) : null });
  }

  if (area === "storage" && op.length === 2) {
    const client = await userClient();
    if (action === "upload") {
      let form: FormData;
      try {
        form = await request.formData();
      } catch {
        return json({ data: null, error: { name: "StorageApiError", message: "Invalid upload", status: 400, statusCode: "400" } });
      }
      const file = form.get("file");
      if (!(file instanceof Blob)) return json({ data: null, error: { name: "StorageApiError", message: "No file", status: 400, statusCode: "400" } });
      const contentType = typeof form.get("contentType") === "string" ? (form.get("contentType") as string) : undefined;
      const cacheControl = typeof form.get("cacheControl") === "string" ? (form.get("cacheControl") as string) : undefined;
      const body = form.get("blob") === "true" ? file : new Uint8Array(await file.arrayBuffer());
      const res = await client.storage
        .from(String(form.get("bucket") ?? ""))
        .upload(String(form.get("path") ?? ""), body, { contentType, cacheControl, upsert: form.get("upsert") === "true" });
      return json({ data: res.data, error: res.error ? errorJson(res.error) : null });
    }

    let body: { bucket?: string | null; path?: string; method?: string; args?: unknown[] } = {};
    try {
      body = ((await request.json()) ?? {}) as typeof body;
    } catch {
      // empty body
    }
    if (action === "download") {
      const res = await client.storage.from(String(body.bucket ?? "")).download(String(body.path ?? ""));
      if (res.error || !res.data) return json({ data: null, error: errorJson(res.error) }, 400);
      return new NextResponse(res.data, { status: 200, headers: { "Content-Type": res.data.type || "application/octet-stream", "Cache-Control": "no-store" } });
    }
    if (action === "call") {
      const args = Array.isArray(body.args) ? body.args : [];
      if (body.method === "listBuckets") {
        const res = await client.storage.listBuckets();
        return json({ data: res.data, error: res.error ? errorJson(res.error) : null });
      }
      if (body.method === "getBucket") {
        const res = await client.storage.getBucket(String(args[0] ?? ""));
        return json({ data: res.data, error: res.error ? errorJson(res.error) : null });
      }
      if (!body.method || !STORAGE_METHODS.has(body.method)) return notFound();
      const bucket = client.storage.from(String(body.bucket ?? "")) as unknown as Record<string, (...a: unknown[]) => Promise<{ data: unknown; error: unknown }>>;
      const res = await bucket[body.method](...args);
      return json({ data: res.data ?? null, error: res.error ? errorJson(res.error) : null });
    }
  }

  return notFound();
}
