import { WorkspaceInfo } from "@/components/settings/workspace-info";
import { getWorkspaceContext } from "@/lib/data/session";

import { getCompanyWorkspaceId, loadMembers } from "../../_lib/server";

export default async function WorkspaceInfoPage({ params }: PageProps<"/workspaces/[wid]/settings/workspace/info">) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(wid);
  const [members, companyId] = await Promise.all([loadMembers(wid), getCompanyWorkspaceId()]);
  const owner = members.find((m) => m.id === ctx.workspace.owner_id) ?? null;
  const personal = ctx.workspaces.find((w) => w.type === "personal") ?? null;

  return (
    <WorkspaceInfo
      members={members}
      owner={owner}
      isCompany={companyId === wid}
      personalWorkspaceId={personal?.id ?? null}
    />
  );
}
