import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

import { BUCKET } from "./storage";

/** Short-lived signed URL for a storage object (server only, bypasses RLS — authorise first!). */
export async function signedUrl(path: string | null | undefined, expiresIn = 60 * 30) {
  if (!path) return null;
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(path, expiresIn);
  if (error) return null;
  return data.signedUrl;
}

export async function downloadBytes(path: string): Promise<Uint8Array | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(BUCKET).download(path);
  if (error || !data) return null;
  return new Uint8Array(await data.arrayBuffer());
}

export async function uploadBytes(path: string, bytes: Uint8Array, contentType = "application/pdf") {
  const admin = createAdminClient();
  const { error } = await admin.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: true });
  if (error) throw new Error(error.message);
}
