import { redirect } from "next/navigation";

import { getDefaultWorkspaceId } from "@/lib/data/session";

export default async function RootPage() {
  const wid = await getDefaultWorkspaceId();
  if (!wid) redirect("/login");
  redirect(`/workspaces/${wid}/esign/home`);
}
