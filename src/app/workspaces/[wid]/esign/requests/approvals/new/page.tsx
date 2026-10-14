import type { Metadata } from "next";

import { getWorkspaceContext } from "@/lib/data/session";
import { createClient } from "@/lib/supabase/server";
import type { ApprovalLineRecord } from "@/lib/tools/approvals";
import { listWorkspaceMembers } from "@/lib/tools/server";

import { NewApprovalView } from "./new-approval-view";

export const metadata: Metadata = { title: "업로드로 기안 작성 | OpenSign" };

export default async function NewApprovalPage({ params }: PageProps<"/workspaces/[wid]/esign/requests/approvals/new">) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(wid);
  const supabase = await createClient();
  const [members, { data: lines }] = await Promise.all([
    listWorkspaceMembers(supabase, wid),
    supabase.from("approval_lines").select("id, name, approvers").eq("workspace_id", wid).order("last_activity_at", { ascending: false }),
  ]);
  return (
    <NewApprovalView
      wid={wid}
      userId={ctx.profile.id}
      members={members}
      lines={(lines ?? []) as Pick<ApprovalLineRecord, "id" | "name" | "approvers">[]}
    />
  );
}
