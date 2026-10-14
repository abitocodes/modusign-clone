import { AutoShareSettingsView } from "@/components/settings/auto-share";
import { readAutoShare } from "@/components/settings/shared";
import { getWorkspaceContext } from "@/lib/data/session";

import { loadGroups, loadMembers } from "../../_lib/server";

export default async function AutomaticSharingPage({ params }: PageProps<"/workspaces/[wid]/settings/esign/automatic-sharing">) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(wid);
  const [members, groups] = await Promise.all([loadMembers(wid), loadGroups(wid)]);
  return <AutoShareSettingsView members={members} groups={groups} autoShare={readAutoShare(ctx.workspace.settings)} />;
}
