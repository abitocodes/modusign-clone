import { Suspense } from "react";

import { DOCUMENTS_SIDEBAR, ESignSidebar } from "@/components/shell/sidebar";

export default function DocumentsLayout({ children }: LayoutProps<"/workspaces/[wid]/esign/documents">) {
  return (
    <>
      <Suspense>
        <ESignSidebar groups={DOCUMENTS_SIDEBAR} />
      </Suspense>
      <main className="min-w-0 flex-1 bg-surface">{children}</main>
    </>
  );
}
