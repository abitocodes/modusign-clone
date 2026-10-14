import { Suspense } from "react";

import { ESignSidebar, REQUESTS_SIDEBAR } from "@/components/shell/sidebar";

export default function RequestsLayout({ children }: LayoutProps<"/workspaces/[wid]/esign/requests">) {
  return (
    <>
      <Suspense>
        <ESignSidebar groups={REQUESTS_SIDEBAR} />
      </Suspense>
      <main className="min-w-0 flex-1 bg-surface">{children}</main>
    </>
  );
}
