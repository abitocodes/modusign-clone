import type { Metadata } from "next";

import { SettingsShell } from "@/components/settings/settings-shell";

export const metadata: Metadata = { title: "통합 설정 | OpenSign" };

export default function SettingsLayout({ children }: LayoutProps<"/workspaces/[wid]/settings">) {
  return <SettingsShell>{children}</SettingsShell>;
}
