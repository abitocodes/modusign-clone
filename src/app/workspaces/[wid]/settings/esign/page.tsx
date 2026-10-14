import { redirect } from "next/navigation";

export default async function ESignSettingsIndex({ params }: PageProps<"/workspaces/[wid]/settings/esign">) {
  const { wid } = await params;
  redirect(`/workspaces/${wid}/settings/esign/automatic-sharing`);
}
