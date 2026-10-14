/**
 * `supabase.storage` of the preview clients (server side; the browser client forwards to
 * /api/preview/storage, which runs this with the cookie session).
 *
 * Objects live in storage-state.ts. Signed URLs point at `/api/preview/storage?bucket=…&path=…&exp=…&sig=…`
 * (HMAC with a per-process key), optionally with `download=<file name>` for a Content-Disposition.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { previewGlobals } from "./engine/db";
import {
  StorageFailure,
  bucketDef,
  copyObject,
  getObject,
  listBucketDefs,
  listObjects,
  moveObject,
  normalizeKey,
  objectMetadata,
  putObject,
  removeObjects,
  type ListOptions,
} from "./storage-state";
import type { PreviewDb } from "./types";

/** supabase-js StorageApiError look-alike. */
export class PreviewStorageError extends Error {
  status: number;
  statusCode: string;
  __isStorageError = true;
  constructor(message: string, status: number) {
    super(message);
    this.name = "StorageApiError";
    this.status = status;
    this.statusCode = String(status);
  }
  toJSON() {
    return { name: this.name, message: this.message, status: this.status, statusCode: this.statusCode };
  }
}

export interface StorageDeps {
  db: () => Promise<PreviewDb>;
  /** auth.uid() of the caller (storage.objects.owner_id of uploads); null = service role / anon */
  ownerId: () => string | null;
  /** absolute origin the signed URLs point at (e.g. http://localhost:3100) */
  origin: () => Promise<string>;
}

export const STORAGE_ROUTE = "/api/preview/storage";

function toError(e: unknown): PreviewStorageError {
  if (e instanceof PreviewStorageError) return e;
  if (e instanceof StorageFailure) return new PreviewStorageError(e.message, e.status);
  console.warn("[preview] storage error:", e);
  return new PreviewStorageError((e as Error)?.message ?? String(e), 500);
}

/* ------------------------------------------------------------------ signing */

function signingKey(): string {
  const g = previewGlobals();
  if (typeof g.storageKey !== "string") g.storageKey = randomBytes(32).toString("hex");
  return g.storageKey as string;
}

function signature(bucket: string, path: string, exp: number) {
  return createHmac("sha256", signingKey()).update(`${bucket}\n${path}\n${exp}`).digest("base64url");
}

export function signedStorageUrl(origin: string, bucket: string, path: string, expiresIn: number, download?: string | boolean) {
  const exp = Math.floor(Date.now() / 1000) + Math.max(1, Math.floor(Number(expiresIn) || 60));
  const qs = new URLSearchParams({ bucket, path, exp: String(exp), sig: signature(bucket, path, exp) });
  if (download !== undefined && download !== false) qs.set("download", download === true ? "" : String(download));
  return `${origin.replace(/\/$/, "")}${STORAGE_ROUTE}?${qs.toString()}`;
}

/** Checks the query of a signed URL. Returns the object reference or an error message. */
export function verifySignedStorageQuery(q: URLSearchParams): { bucket: string; path: string; download: string | null } | { error: string; status: number } {
  const bucket = q.get("bucket") ?? "";
  const path = q.get("path") ?? "";
  const exp = Number(q.get("exp"));
  const sig = q.get("sig") ?? "";
  if (!bucket || !path || !Number.isFinite(exp) || !sig) return { error: "Invalid signature", status: 400 };
  const expected = Buffer.from(signature(bucket, path, exp));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { error: "Invalid signature", status: 400 };
  if (exp * 1000 < Date.now()) return { error: "Token has expired", status: 400 };
  return { bucket, path, download: q.has("download") ? (q.get("download") ?? "") : null };
}

/* -------------------------------------------------------------------- bodies */

type Body = Blob | ArrayBuffer | ArrayBufferView | string | FormData | null | undefined;

async function toBytes(body: Body): Promise<{ bytes: Uint8Array; type: string | null }> {
  if (typeof Blob !== "undefined" && body instanceof Blob) return { bytes: new Uint8Array(await body.arrayBuffer()), type: body.type || null };
  if (body instanceof ArrayBuffer) return { bytes: new Uint8Array(body.slice(0)), type: null };
  if (ArrayBuffer.isView(body)) {
    const view = body as ArrayBufferView;
    return { bytes: new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer), type: null };
  }
  if (typeof body === "string") return { bytes: new TextEncoder().encode(body), type: null };
  if (typeof FormData !== "undefined" && body instanceof FormData) {
    for (const [, v] of body.entries()) {
      if (typeof v !== "string") return toBytes(v);
    }
  }
  throw new PreviewStorageError("Unsupported upload body", 400);
}

/* ----------------------------------------------------------------- bucket API */

export interface FileOptions {
  contentType?: string;
  cacheControl?: string;
  upsert?: boolean;
  duplex?: string;
  metadata?: Record<string, unknown>;
}

function bucketApi(deps: StorageDeps, bucket: string) {
  const run = async <T>(fn: (db: PreviewDb) => T | Promise<T>): Promise<{ data: T | null; error: PreviewStorageError | null }> => {
    try {
      const db = await deps.db();
      return { data: await fn(db), error: null };
    } catch (e) {
      return { data: null, error: toError(e) };
    }
  };

  const write = (path: string, body: Body, opts: FileOptions | undefined, forceUpsert: boolean) =>
    run(async (db) => {
      const { bytes, type } = await toBytes(body);
      const blobBody = typeof Blob !== "undefined" && body instanceof Blob;
      // like storage-js: a Blob goes as multipart (its own type), other bodies carry options.contentType
      const contentType = blobBody ? type || opts?.contentType || "application/octet-stream" : opts?.contentType || "text/plain;charset=UTF-8";
      const obj = putObject(db, bucket, path, bytes, {
        contentType,
        cacheControl: opts?.cacheControl,
        upsert: forceUpsert || !!opts?.upsert,
        ownerId: deps.ownerId(),
      });
      return { id: obj.id, path: obj.name, fullPath: `${bucket}/${obj.name}` };
    });

  return {
    upload: (path: string, body: Body, opts?: FileOptions) => write(path, body, opts, false),
    update: (path: string, body: Body, opts?: FileOptions) => write(path, body, opts, true),
    download: (path: string, _opts?: unknown) =>
      run((db) => {
        void _opts;
        const obj = getObject(db, bucket, path);
        if (!obj) throw new PreviewStorageError("Object not found", 400);
        return new Blob([obj.bytes as BlobPart], { type: obj.contentType });
      }),
    createSignedUrl: (path: string, expiresIn: number, opts?: { download?: string | boolean; transform?: unknown }) =>
      run(async (db) => {
        const key = normalizeKey(path);
        if (!getObject(db, bucket, key)) throw new PreviewStorageError("Object not found", 400);
        return { signedUrl: signedStorageUrl(await deps.origin(), bucket, key, expiresIn, opts?.download) };
      }),
    createSignedUrls: (paths: string[], expiresIn: number, opts?: { download?: string | boolean }) =>
      run(async (db) => {
        const origin = await deps.origin();
        return (paths ?? []).map((p) => {
          let key = String(p ?? "");
          try {
            key = normalizeKey(p);
          } catch {
            return { error: "Either the object does not exist or you do not have access to it", path: key, signedUrl: "" };
          }
          if (!getObject(db, bucket, key)) return { error: "Either the object does not exist or you do not have access to it", path: key, signedUrl: "" };
          return { error: null, path: key, signedUrl: signedStorageUrl(origin, bucket, key, expiresIn, opts?.download) };
        });
      }),
    remove: (paths: string[]) =>
      run((db) =>
        removeObjects(db, bucket, Array.isArray(paths) ? paths : []).map((o) => ({
          name: o.name,
          bucket_id: bucket,
          owner: o.owner_id ?? "",
          owner_id: o.owner_id ?? "",
          id: o.id,
          updated_at: o.updated_at,
          created_at: o.created_at,
          last_accessed_at: o.last_accessed_at,
          metadata: objectMetadata(o),
        })),
      ),
    copy: (from: string, to: string, opts?: { destinationBucket?: string }) =>
      run((db) => {
        const obj = copyObject(db, bucket, from, to, deps.ownerId(), opts?.destinationBucket ?? bucket);
        return { path: obj.name };
      }),
    move: (from: string, to: string, opts?: { destinationBucket?: string }) =>
      run((db) => {
        moveObject(db, bucket, from, to, deps.ownerId(), opts?.destinationBucket ?? bucket);
        return { message: "Successfully moved" };
      }),
    list: (prefix?: string, opts?: ListOptions, _params?: unknown) =>
      run((db) => {
        void _params;
        return listObjects(db, bucket, prefix, opts ?? {});
      }),
    exists: (path: string) => run((db) => !!getObject(db, bucket, path)),
    info: (path: string) =>
      run((db) => {
        const o = getObject(db, bucket, path);
        if (!o) throw new PreviewStorageError("Object not found", 404);
        return {
          id: o.id,
          name: o.name,
          bucketId: bucket,
          size: o.bytes.byteLength,
          contentType: o.contentType,
          cacheControl: o.cacheControl,
          etag: objectMetadata(o).eTag,
          createdAt: o.created_at,
          lastModified: o.updated_at,
          metadata: {},
        };
      }),
    getPublicUrl: (path: string) => {
      const origin = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3100").replace(/\/$/, "");
      return { data: { publicUrl: `${origin}${STORAGE_ROUTE}/public/${encodeURIComponent(bucket)}/${String(path ?? "").split("/").map(encodeURIComponent).join("/")}` } };
    },
  };
}

export function createStorageApi(deps: StorageDeps) {
  return {
    from: (bucket: string) => bucketApi(deps, bucket),
    async listBuckets() {
      try {
        return { data: listBucketDefs(await deps.db()), error: null };
      } catch (e) {
        return { data: null, error: toError(e) };
      }
    },
    async getBucket(id: string) {
      try {
        const b = bucketDef(await deps.db(), id);
        if (!b) throw new PreviewStorageError("Bucket not found", 404);
        return { data: b, error: null };
      } catch (e) {
        return { data: null, error: toError(e) };
      }
    },
  };
}

export type PreviewStorageApi = ReturnType<typeof createStorageApi>;
