import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getWorkspaceContext } from "@/lib/data/session";
import { BUCKET } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import type { ApprovalEventRow, ApprovalListItem } from "@/lib/tools/approvals";
import { isUuid } from "@/lib/tools/result";

import { ApprovalDetailView } from "./approval-detail-view";

export const metadata: Metadata = { title: "내부결재 | OpenSign" };

export default async function ApprovalDetailPage({ params }: PageProps<"/workspaces/[wid]/esign/requests/approvals/[id]">) {
  const { wid, id } = await params;
  const ctx = await getWorkspaceContext(wid);
  if (!isUuid(id)) notFound();

  const supabase = await createClient();
  // RLS: only the drafter and the approvers can read the 기안
  const { data: approval, error } = await supabase
    .from("approvals")
    .select("*, drafter:profiles!approvals_drafter_id_fkey(id, name, email)")
    .eq("id", id)
    .eq("workspace_id", wid)
    .maybeSingle();
  if (error) throw new Error("기안 문서를 불러오지 못했습니다.");
  if (!approval) notFound();
  const row = approval as unknown as ApprovalListItem;

  const [{ data: events }, signed] = await Promise.all([
    supabase.from("approval_events").select("*").eq("approval_id", id).order("created_at", { ascending: true }),
    row.file_path ? supabase.storage.from(BUCKET).createSignedUrl(row.file_path, 60 * 60) : Promise.resolve(null),
  ]);

  return (
    <ApprovalDetailView
      wid={wid}
      userId={ctx.profile.id}
      approval={row}
      events={(events ?? []) as ApprovalEventRow[]}
      pdfUrl={signed?.data?.signedUrl ?? null}
    />
  );
}
