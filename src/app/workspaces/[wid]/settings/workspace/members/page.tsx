import { MembersManager } from "@/components/settings/members-manager";
import { getWorkspaceContext } from "@/lib/data/session";
import { createAdminClient } from "@/lib/supabase/admin";
import type { MemberRole } from "@/lib/types";

import { getCompanyWorkspaceId, loadMembers } from "../../_lib/server";

export default async function MembersPage({ params }: PageProps<"/workspaces/[wid]/settings/workspace/members">) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(wid);
  const [members, companyId] = await Promise.all([loadMembers(wid), getCompanyWorkspaceId()]);

  // Account-level permissions (password reset, 아이디 수정, account deletion) come from the company workspace role.
  let accountRole: MemberRole | null = null;
  let companyOwnerIds: string[] = [];
  if (companyId) {
    const { data } = await createAdminClient()
      .from("workspace_members")
      .select("user_id, role")
      .eq("workspace_id", companyId)
      .in("role", ["owner", "admin"]);
    const rows = (data ?? []) as { user_id: string; role: MemberRole }[];
    accountRole = rows.find((r) => r.user_id === ctx.profile.id)?.role ?? null;
    companyOwnerIds = rows.filter((r) => r.role === "owner").map((r) => r.user_id);
  }

  return (
    <MembersManager
      members={members}
      primaryOwnerId={ctx.workspace.owner_id}
      accountRole={accountRole}
      companyOwnerIds={companyOwnerIds}
    />
  );
}
