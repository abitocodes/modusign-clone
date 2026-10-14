import { GroupsManager } from "@/components/settings/groups-manager";
import { getWorkspaceContext } from "@/lib/data/session";

import { loadGroups, loadMembers } from "../../_lib/server";

export default async function GroupsPage({ params }: PageProps<"/workspaces/[wid]/settings/workspace/groups">) {
  const { wid } = await params;
  await getWorkspaceContext(wid);
  const [members, groups] = await Promise.all([loadMembers(wid), loadGroups(wid)]);
  return <GroupsManager members={members} groups={groups} />;
}
