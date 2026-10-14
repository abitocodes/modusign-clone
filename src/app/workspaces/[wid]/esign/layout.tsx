import { ESignShell } from "@/components/shell/esign-shell";

export default function ESignLayout({ children }: LayoutProps<"/workspaces/[wid]/esign">) {
  return <ESignShell>{children}</ESignShell>;
}
