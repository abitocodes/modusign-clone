import type { Metadata } from "next";

import { getWorkspaceContext } from "@/lib/data/session";
import { signedUrl } from "@/lib/storage-server";
import { createClient } from "@/lib/supabase/server";
import type { RequestType } from "@/lib/types";

import type { TemplateCardData } from "./template-section";
import { UploadClient } from "./upload-client";

export const metadata: Metadata = { title: "문서 업로드 | OpenSign" };

export default async function UploadPage({ params }: PageProps<"/workspaces/[wid]/documents/d/upload">) {
  const { wid } = await params;
  await getWorkspaceContext(wid); // 404 for non-members

  const supabase = await createClient();
  const { data } = await supabase
    .from("templates")
    .select("id, title, request_type, page_count, file_path, pinned, updated_at")
    .eq("workspace_id", wid)
    .not("file_path", "is", null)
    .order("updated_at", { ascending: false })
    .limit(30);

  type Row = { id: string; title: string; request_type: RequestType; page_count: number; file_path: string | null };
  const templates: TemplateCardData[] = await Promise.all(
    ((data ?? []) as Row[]).map(async (t) => ({
      id: t.id,
      title: t.title,
      requestType: t.request_type,
      pageCount: t.page_count,
      // the rows above were read with the member's RLS session → safe to sign their files
      thumbUrl: await signedUrl(t.file_path, 60 * 30),
    })),
  );

  return <UploadClient wid={wid} templates={templates} />;
}
