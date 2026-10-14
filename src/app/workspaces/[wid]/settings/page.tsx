import { redirect } from "next/navigation";

export default async function SettingsIndex({ params }: PageProps<"/workspaces/[wid]/settings">) {
  const { wid } = await params;
  redirect(`/workspaces/${wid}/settings/workspace/info`);
}
