/**
 * Browser-side preview client (src/lib/supabase/client.ts in preview mode): the supabase-js
 * surface the client components use, forwarded to /api/preview/* where the server runs it with
 * the cookie session.
 *
 *  * from / rpc  → POST /api/preview/data (the recorded call chain as JSON)
 *  * storage     → POST /api/preview/storage/{upload|download|call} (uploads as FormData)
 *  * auth        → POST /api/preview/auth/<method>
 *
 * Browser-safe: imports only the engine's recorder (types otherwise).
 */
import { createRecorder } from "./engine/recorder";
import type { DataOp, PgResult } from "./types";

const BASE = "/api/preview";

class PreviewClientError extends Error {
  status: number;
  statusCode: string;
  code: string;
  __isAuthError?: boolean;
  __isStorageError?: boolean;
  constructor(e: { name?: string; message?: string; status?: number; statusCode?: string; code?: string }, kind: "auth" | "storage") {
    super(e?.message ?? "요청을 처리하지 못했습니다.");
    this.name = e?.name ?? (kind === "auth" ? "AuthApiError" : "StorageApiError");
    this.status = Number(e?.status ?? 500);
    this.statusCode = e?.statusCode ?? String(this.status);
    this.code = e?.code ?? "";
    if (kind === "auth") this.__isAuthError = true;
    else this.__isStorageError = true;
  }
}

async function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? null),
    credentials: "same-origin",
    cache: "no-store",
  });
}

type Envelope = { data: unknown; error: Record<string, unknown> | null };

async function call(path: string, body: unknown, kind: "auth" | "storage"): Promise<{ data: unknown; error: PreviewClientError | null }> {
  try {
    const res = await postJson(path, body);
    const json = (await res.json()) as Envelope;
    return { data: json.data ?? null, error: json.error ? new PreviewClientError(json.error, kind) : null };
  } catch (e) {
    return { data: null, error: new PreviewClientError({ name: kind === "auth" ? "AuthRetryableFetchError" : "StorageUnknownError", message: (e as Error)?.message, status: 0 }, kind) };
  }
}

type Body = Blob | ArrayBuffer | ArrayBufferView | string | FormData;

function toBlob(body: Body, contentType?: string): Blob {
  if (body instanceof Blob) return body;
  if (typeof FormData !== "undefined" && body instanceof FormData) {
    for (const [, v] of body.entries()) if (typeof v !== "string") return v;
    return new Blob([], { type: contentType });
  }
  if (typeof body === "string") return new Blob([body], { type: contentType || "text/plain;charset=UTF-8" });
  const view = body as ArrayBuffer | ArrayBufferView;
  const bytes = view instanceof ArrayBuffer ? new Uint8Array(view) : new Uint8Array(view.buffer as ArrayBuffer, view.byteOffset, view.byteLength);
  return new Blob([bytes as BlobPart], { type: contentType || "text/plain;charset=UTF-8" });
}

function bucketApi(bucket: string) {
  const invoke = (method: string, args: unknown[]) => call("/storage/call", { bucket, method, args }, "storage");
  const write = async (path: string, body: Body, opts: { contentType?: string; upsert?: boolean; cacheControl?: string } | undefined, upsert: boolean) => {
    try {
      const form = new FormData();
      form.set("bucket", bucket);
      form.set("path", path);
      form.set("upsert", String(upsert || !!opts?.upsert));
      if (opts?.contentType) form.set("contentType", opts.contentType);
      if (opts?.cacheControl) form.set("cacheControl", String(opts.cacheControl));
      // a Blob keeps its own type (like storage-js multipart uploads); other bodies carry contentType
      form.set("blob", String(body instanceof Blob));
      form.set("file", toBlob(body, opts?.contentType));
      const res = await fetch(`${BASE}/storage/upload`, { method: "POST", body: form, credentials: "same-origin", cache: "no-store" });
      const json = (await res.json()) as Envelope;
      return { data: json.data ?? null, error: json.error ? new PreviewClientError(json.error, "storage") : null };
    } catch (e) {
      return { data: null, error: new PreviewClientError({ message: (e as Error)?.message, status: 0 }, "storage") };
    }
  };
  return {
    upload: (path: string, body: Body, opts?: { contentType?: string; upsert?: boolean; cacheControl?: string }) => write(path, body, opts, false),
    update: (path: string, body: Body, opts?: { contentType?: string; upsert?: boolean; cacheControl?: string }) => write(path, body, opts, true),
    async download(path: string) {
      try {
        const res = await postJson("/storage/download", { bucket, path });
        if ((res.headers.get("content-type") ?? "").includes("application/json")) {
          const json = (await res.json()) as Envelope;
          return { data: null, error: new PreviewClientError(json.error ?? { message: "Object not found", status: 400 }, "storage") };
        }
        return { data: await res.blob(), error: null };
      } catch (e) {
        return { data: null, error: new PreviewClientError({ message: (e as Error)?.message, status: 0 }, "storage") };
      }
    },
    createSignedUrl: (path: string, expiresIn: number, opts?: { download?: string | boolean }) => invoke("createSignedUrl", [path, expiresIn, opts]),
    createSignedUrls: (paths: string[], expiresIn: number, opts?: { download?: string | boolean }) => invoke("createSignedUrls", [paths, expiresIn, opts]),
    remove: (paths: string[]) => invoke("remove", [paths]),
    copy: (from: string, to: string, opts?: { destinationBucket?: string }) => invoke("copy", [from, to, opts]),
    move: (from: string, to: string, opts?: { destinationBucket?: string }) => invoke("move", [from, to, opts]),
    list: (prefix?: string, opts?: unknown) => invoke("list", [prefix, opts]),
    exists: (path: string) => invoke("exists", [path]),
    info: (path: string) => invoke("info", [path]),
    getPublicUrl: (path: string) => ({
      data: {
        publicUrl: `${typeof location !== "undefined" ? location.origin : ""}${BASE}/storage/public/${encodeURIComponent(bucket)}/${String(path ?? "")
          .split("/")
          .map(encodeURIComponent)
          .join("/")}`,
      },
    }),
  };
}

/** The preview counterpart of `createBrowserClient(url, anonKey)`. */
export function createPreviewBrowserClient() {
  const recorder = createRecorder(async (op: DataOp) => {
    const res = await postJson("/data", op);
    if (!(res.headers.get("content-type") ?? "").includes("application/json")) throw new Error(`preview data API answered HTTP ${res.status}`);
    return (await res.json()) as PgResult;
  });
  const authCall = (method: string, args: unknown[] = []) => call(`/auth/${method}`, { args }, "auth");
  return {
    from: recorder.from,
    rpc: recorder.rpc,
    schema: () => ({ from: recorder.from, rpc: recorder.rpc }),
    storage: {
      from: (bucket: string) => bucketApi(bucket),
      listBuckets: () => call("/storage/call", { bucket: null, method: "listBuckets", args: [] }, "storage"),
      getBucket: (id: string) => call("/storage/call", { bucket: null, method: "getBucket", args: [id] }, "storage"),
    },
    auth: {
      getUser: () => authCall("getUser"),
      getSession: () => authCall("getSession"),
      signInWithPassword: (credentials: { email?: string; phone?: string; password: string }) => authCall("signInWithPassword", [credentials]),
      signOut: (options?: { scope?: string }) => authCall("signOut", [options]),
      updateUser: (attributes: Record<string, unknown>) => authCall("updateUser", [attributes]),
      refreshSession: () => authCall("refreshSession"),
      onAuthStateChange: (_cb: unknown) => {
        void _cb;
        return { data: { subscription: { id: "preview", callback: () => undefined, unsubscribe: () => undefined } } };
      },
    },
    channel: () => ({ on: () => ({ subscribe: () => undefined }), subscribe: () => undefined, unsubscribe: async () => "ok" }),
    removeChannel: async () => "ok",
  };
}
