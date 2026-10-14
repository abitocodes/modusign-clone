import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cache } from "react";

import { getWorkspaceContext } from "@/lib/data/session";
import { createClient } from "@/lib/supabase/server";

import { EDITABLE_STATUSES, isUuid } from "../_lib/access";
import { CompletedClient, type CompletedDoc } from "./completed-client";

/** The document the wizard just sent (RLS: members of the workspace). */
const loadCompletedDoc = cache(async (wid: string, docId: unknown): Promise<CompletedDoc | null> => {
  if (!isUuid(docId)) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("documents")
    .select("id, title, status, request_type, scheduled_at")
    .eq("id", docId)
    .eq("workspace_id", wid)
    .maybeSingle();
  return (data as CompletedDoc | null) ?? null;
});

export async function generateMetadata({ params, searchParams }: PageProps<"/workspaces/[wid]/documents/d/completed">): Promise<Metadata> {
  const { wid } = await params;
  const { doc } = await searchParams;
  const row = await loadCompletedDoc(wid, doc);
  return { title: `${row?.status === "scheduled" ? "예약 완료" : "전송 완료"} | OpenSign` };
}

export default async function SendCompletedPage({ params, searchParams }: PageProps<"/workspaces/[wid]/documents/d/completed">) {
  const { wid } = await params;
  const { doc: docParam } = await searchParams;
  await getWorkspaceContext(wid); // 404 for non-members

  const doc = await loadCompletedDoc(wid, docParam);
  // not sent yet (e.g. opened by URL) → back to the last wizard step instead of a false "전송 완료"
  if (doc && EDITABLE_STATUSES.includes(doc.status)) redirect(`/workspaces/${wid}/documents/d/${doc.id}/steps/3`);

  return <CompletedClient wid={wid} doc={doc} />;
}
