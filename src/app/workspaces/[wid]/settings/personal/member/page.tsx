import { MyMemberInfo } from "@/components/settings/my-member-info";
import { readAutoShare } from "@/components/settings/shared";
import { getWorkspaceContext } from "@/lib/data/session";

import { loadGroups, loadMembers } from "../../_lib/server";

export default async function MyMemberPage({ params }: PageProps<"/workspaces/[wid]/settings/personal/member">) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(wid);
  const [members, groups] = await Promise.all([loadMembers(wid), loadGroups(wid)]);
  const me = ctx.profile.id;
  const byId = new Map(members.map((m) => [m.id, m.name]));
  const shareTargets = (readAutoShare(ctx.workspace.settings).mine[me] ?? [])
    .map((id) => byId.get(id))
    .filter((n): n is string => !!n);

  return (
    <MyMemberInfo
      groupNames={groups.filter((g) => g.memberIds.includes(me)).map((g) => g.name)}
      shareTargets={shareTargets}
    />
  );
}
