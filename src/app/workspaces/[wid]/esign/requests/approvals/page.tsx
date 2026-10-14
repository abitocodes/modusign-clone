import type { Metadata } from "next";

import { getWorkspaceContext } from "@/lib/data/session";
import { createClient } from "@/lib/supabase/server";
import type { ApprovalListItem } from "@/lib/tools/approvals";

import { ApprovalsView } from "./approvals-view";

export const metadata: Metadata = { title: "내부결재 | OpenSign" };

export default async function ApprovalsPage({ params }: PageProps<"/workspaces/[wid]/esign/requests/approvals">) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(wid);
  const supabase = await createClient();
  // RLS returns only the 기안 I drafted or where I am one of the approvers
  const { data, error } = await supabase
    .from("approvals")
    .select("*, drafter:profiles!approvals_drafter_id_fkey(id, name, email)")
    .eq("workspace_id", wid)
    .order("last_activity_at", { ascending: false });
  if (error) throw new Error("기안 문서 목록을 불러오지 못했습니다.");
  return <ApprovalsView wid={wid} userId={ctx.profile.id} approvals={(data ?? []) as unknown as ApprovalListItem[]} />;
}
