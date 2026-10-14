import { redirect } from "next/navigation";

export default async function PersonalSettingsIndex({ params }: PageProps<"/workspaces/[wid]/settings/personal">) {
  const { wid } = await params;
  redirect(`/workspaces/${wid}/settings/personal/member`);
}
