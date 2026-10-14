import { redirect } from "next/navigation";

export default async function WorkspaceSettingsIndex({ params }: PageProps<"/workspaces/[wid]/settings/workspace">) {
  const { wid } = await params;
  redirect(`/workspaces/${wid}/settings/workspace/info`);
}
