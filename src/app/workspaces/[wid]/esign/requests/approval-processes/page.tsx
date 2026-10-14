import type { Metadata } from "next";

import { getWorkspaceContext } from "@/lib/data/session";
import { createClient } from "@/lib/supabase/server";
import type { ApprovalLineRecord } from "@/lib/tools/approvals";
import { listWorkspaceMembers } from "@/lib/tools/server";

import { ApprovalLinesView } from "./approval-lines-view";

export const metadata: Metadata = { title: "결재선 | OpenSign" };

export default async function ApprovalProcessesPage({ params }: PageProps<"/workspaces/[wid]/esign/requests/approval-processes">) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(wid);
  const supabase = await createClient();
  const [{ data, error }, members] = await Promise.all([
    supabase.from("approval_lines").select("*").eq("workspace_id", wid).order("last_activity_at", { ascending: false }),
    listWorkspaceMembers(supabase, wid),
  ]);
  if (error) throw new Error("결재선 목록을 불러오지 못했습니다.");
  return (
    <ApprovalLinesView
      wid={wid}
      userId={ctx.profile.id}
      canManageAll={ctx.role !== "member"}
      lines={(data ?? []) as ApprovalLineRecord[]}
      members={members}
    />
  );
}
