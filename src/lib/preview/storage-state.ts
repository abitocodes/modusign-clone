/**
 * In-memory object store of preview mode (the data behind storage.ts; also read by RPCs such as
 * approval_submit, which looks at `storage.objects`). Lives on the preview database's `meta`, so it
 * is HMR-safe and dropped together with the demo data.
 *
 * No "@/…" / "server-only" imports (testable under plain Node). Bytes are treated as immutable:
 * copies share the same Uint8Array.
 */
import type { PreviewDb } from "./types";

export interface StoredObject {
  id: string;
  bucket: string;
  name: string;
  bytes: Uint8Array;
  contentType: string;
  cacheControl: string;
  /** auth.uid() of the uploader (null = service role), like storage.objects.owner_id */
  owner_id: string | null;
  created_at: string;
  updated_at: string;
  last_accessed_at: string;
}

export interface BucketDef {
  id: string;
  name: string;
  public: boolean;
  file_size_limit: number | null;
  allowed_mime_types: string[] | null;
  created_at: string;
  updated_at: string;
}

/** The buckets created by the migrations (init + wizard + security hardening). */
const BUCKET_DEFS: Omit<BucketDef, "created_at" | "updated_at">[] = [
  {
    id: "documents",
    name: "documents",
    public: false,
    file_size_limit: 31_457_280,
    allowed_mime_types: [
      "application/haansofthwp",
      "application/hwp+zip",
      "application/msword",
      "application/octet-stream",
      "application/pdf",
      "application/vnd.hancom.hwp",
      "application/vnd.hancom.hwpx",
      "application/vnd.ms-excel",
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/x-hwp",
      "application/x-zip-compressed",
      "application/zip",
      "image/gif",
      "image/jpeg",
      "image/png",
      "image/webp",
      "text/csv",
      "text/plain",
    ],
  },
];

export class StorageFailure extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "StorageApiError";
    this.status = status;
  }
}

interface StorageState {
  buckets: Map<string, BucketDef>;
  objects: Map<string, Map<string, StoredObject>>;
}

const META_KEY = "storage";

function state(db: Pick<PreviewDb, "meta">): StorageState {
  let s = db.meta[META_KEY] as StorageState | undefined;
  if (!s || !(s.objects instanceof Map)) {
    const at = new Date().toISOString();
    s = {
      buckets: new Map(BUCKET_DEFS.map((b) => [b.id, { ...b, created_at: at, updated_at: at }])),
      objects: new Map(BUCKET_DEFS.map((b) => [b.id, new Map()])),
    };
    db.meta[META_KEY] = s;
  }
  return s;
}

export function listBucketDefs(db: Pick<PreviewDb, "meta">): BucketDef[] {
  return [...state(db).buckets.values()].map((b) => ({ ...b, allowed_mime_types: b.allowed_mime_types ? [...b.allowed_mime_types] : null }));
}

export function bucketDef(db: Pick<PreviewDb, "meta">, bucket: string): BucketDef | null {
  return state(db).buckets.get(bucket) ?? null;
}

function objectsOf(db: Pick<PreviewDb, "meta">, bucket: string): Map<string, StoredObject> {
  const s = state(db);
  const objects = s.objects.get(bucket);
  if (!s.buckets.has(bucket) || !objects) throw new StorageFailure("Bucket not found", 404);
  return objects;
}

/** Object names as storage-api accepts them (no leading slash, no empty / dot segments). */
export function normalizeKey(path: unknown): string {
  const p = String(path ?? "").replace(/^\/+/, "").replace(/\/+$/, "").replace(/\/{2,}/g, "/");
  if (!p || p.split("/").some((seg) => seg === "." || seg === "..")) throw new StorageFailure("Invalid key: " + String(path ?? ""), 400);
  return p;
}

export function getObject(db: Pick<PreviewDb, "meta">, bucket: string, path: string): StoredObject | null {
  return objectsOf(db, bucket).get(normalizeKey(path)) ?? null;
}

export interface PutOptions {
  contentType?: string;
  cacheControl?: string;
  upsert?: boolean;
  ownerId?: string | null;
  /** skip the bucket's size / mime checks (seed and server-generated files are within them anyway) */
  trusted?: boolean;
  at?: string;
}

const baseMime = (t: string) => t.split(";")[0].trim().toLowerCase();

export function putObject(db: Pick<PreviewDb, "meta"> & { uuid(): string }, bucket: string, path: string, bytes: Uint8Array, opts: PutOptions = {}): StoredObject {
  const objects = objectsOf(db, bucket);
  const def = bucketDef(db, bucket);
  const key = normalizeKey(path);
  const contentType = opts.contentType || "application/octet-stream";
  if (!opts.trusted && def) {
    if (def.file_size_limit !== null && bytes.byteLength > def.file_size_limit) {
      throw new StorageFailure("The object exceeded the maximum allowed size", 413);
    }
    if (def.allowed_mime_types && !def.allowed_mime_types.includes(baseMime(contentType))) {
      throw new StorageFailure(`mime type ${contentType} is not supported`, 415);
    }
  }
  const existing = objects.get(key);
  if (existing && !opts.upsert) throw new StorageFailure("The resource already exists", 409);
  const at = opts.at ?? new Date().toISOString();
  const obj: StoredObject = {
    id: existing?.id ?? db.uuid(),
    bucket,
    name: key,
    bytes,
    contentType,
    cacheControl: opts.cacheControl ?? "3600",
    owner_id: opts.ownerId ?? null,
    created_at: existing?.created_at ?? at,
    updated_at: at,
    last_accessed_at: at,
  };
  objects.set(key, obj);
  return obj;
}

export function removeObjects(db: Pick<PreviewDb, "meta">, bucket: string, paths: string[]): StoredObject[] {
  const objects = objectsOf(db, bucket);
  const out: StoredObject[] = [];
  for (const p of paths) {
    let key: string;
    try {
      key = normalizeKey(p);
    } catch {
      continue;
    }
    const obj = objects.get(key);
    if (obj) {
      objects.delete(key);
      out.push(obj);
    }
  }
  return out;
}

export function copyObject(db: Pick<PreviewDb, "meta"> & { uuid(): string }, bucket: string, from: string, to: string, ownerId: string | null, destinationBucket = bucket) {
  const src = getObject(db, bucket, from);
  if (!src) throw new StorageFailure("Object not found", 404);
  return putObject(db, destinationBucket, to, src.bytes, { contentType: src.contentType, cacheControl: src.cacheControl, ownerId, trusted: true });
}

export function moveObject(db: Pick<PreviewDb, "meta"> & { uuid(): string }, bucket: string, from: string, to: string, ownerId: string | null, destinationBucket = bucket) {
  const src = getObject(db, bucket, from);
  if (!src) throw new StorageFailure("Object not found", 404);
  const moved = putObject(db, destinationBucket, to, src.bytes, { contentType: src.contentType, cacheControl: src.cacheControl, ownerId: ownerId ?? src.owner_id, trusted: true });
  removeObjects(db, bucket, [src.name]);
  return moved;
}

/** `storage.objects.metadata` of an object (what supabase-js `list()` reports). */
export function objectMetadata(o: StoredObject) {
  return {
    eTag: `"${o.id.replace(/-/g, "").slice(0, 32)}"`,
    size: o.bytes.byteLength,
    mimetype: o.contentType,
    cacheControl: `max-age=${o.cacheControl}`,
    lastModified: o.updated_at,
    contentLength: o.bytes.byteLength,
    httpStatusCode: 200,
  };
}

export interface ListOptions {
  limit?: number;
  offset?: number;
  search?: string;
  sortBy?: { column?: string; order?: string };
}

/** storage `list(prefix)`: direct children (files, plus "folders" with id null), sorted by name. */
export function listObjects(db: Pick<PreviewDb, "meta">, bucket: string, prefix: string | undefined, opts: ListOptions = {}) {
  const objects = objectsOf(db, bucket);
  const base = String(prefix ?? "").replace(/^\/+/, "").replace(/\/+$/, "");
  const lead = base ? `${base}/` : "";
  const search = String(opts.search ?? "").toLowerCase();
  const files = new Map<string, StoredObject>();
  const folders = new Set<string>();
  for (const [key, obj] of objects) {
    if (!key.startsWith(lead)) continue;
    const rest = key.slice(lead.length);
    const slash = rest.indexOf("/");
    const name = slash < 0 ? rest : rest.slice(0, slash);
    if (!name || (search && !name.toLowerCase().startsWith(search))) continue;
    if (slash < 0) files.set(name, obj);
    else folders.add(name);
  }
  type Entry = {
    name: string;
    id: string | null;
    updated_at: string | null;
    created_at: string | null;
    last_accessed_at: string | null;
    metadata: ReturnType<typeof objectMetadata> | null;
  };
  const entries: Entry[] = [
    ...[...folders].filter((f) => !files.has(f)).map((name) => ({ name, id: null, updated_at: null, created_at: null, last_accessed_at: null, metadata: null })),
    ...[...files].map(([name, o]) => ({
      name,
      id: o.id,
      updated_at: o.updated_at,
      created_at: o.created_at,
      last_accessed_at: o.last_accessed_at,
      metadata: objectMetadata(o),
    })),
  ];
  const column = (opts.sortBy?.column ?? "name") as keyof Entry;
  const desc = String(opts.sortBy?.order ?? "asc").toLowerCase() === "desc";
  entries.sort((a, b) => {
    // folders first, like storage.search()
    if ((a.id === null) !== (b.id === null)) return a.id === null ? -1 : 1;
    const x = String(a[column] ?? "");
    const y = String(b[column] ?? "");
    const c = x < y ? -1 : x > y ? 1 : 0;
    return desc ? -c : c;
  });
  const offset = Math.max(0, Math.floor(opts.offset ?? 0));
  const limit = Math.max(1, Math.floor(opts.limit ?? 100));
  return entries.slice(offset, offset + limit);
}

/** Every object (debugging / self-test). */
export function allObjects(db: Pick<PreviewDb, "meta">): StoredObject[] {
  return [...state(db).objects.values()].flatMap((m) => [...m.values()]);
}
