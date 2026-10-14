import { WorkspaceProvider } from "@/components/shell/workspace-context";
import { getWorkspaceContext } from "@/lib/data/session";

export default async function WorkspaceLayout({ children, params }: LayoutProps<"/workspaces/[wid]">) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(wid);
  return <WorkspaceProvider value={ctx}>{children}</WorkspaceProvider>;
}
