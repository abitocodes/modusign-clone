import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getWorkspaceContext } from "@/lib/data/session";
import { isUuid } from "@/lib/templates/model";

import { UseTemplateClient } from "./use-client";

export const metadata: Metadata = { title: "템플릿으로 시작 | OpenSign" };

/**
 * /templates/[tid]/use — the draft is created by a Server Action started from the client
 * (never during render), so link prefetching cannot create documents.
 */
export default async function UseTemplatePage({ params }: PageProps<"/workspaces/[wid]/templates/[tid]/use">) {
  const { wid, tid } = await params;
  await getWorkspaceContext(wid); // 404 for non-members
  if (!isUuid(tid)) notFound();
  return <UseTemplateClient wid={wid} tid={tid} />;
}
