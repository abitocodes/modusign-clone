"use client";

import { createContext, useContext, type ReactNode } from "react";

import type { WorkspaceContextData } from "@/lib/data/session";

const Ctx = createContext<WorkspaceContextData | null>(null);

export function WorkspaceProvider({ value, children }: { value: WorkspaceContextData; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Workspace shell data (profile, workspace, role, my workspaces, quota usage). */
export function useWorkspace() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWorkspace must be used inside /workspaces/[wid]");
  return v;
}

/** `/workspaces/<id>` prefix helper */
export function useWsPath() {
  const { workspace } = useWorkspace();
  return (p: string) => `/workspaces/${workspace.id}${p.startsWith("/") ? p : `/${p}`}`;
}
