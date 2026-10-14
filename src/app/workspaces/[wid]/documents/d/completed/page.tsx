import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cache } from "react";

import { getWorkspaceContext } from "@/lib/data/session";
import { canManage, inPersonPending, PARTICIPANT_COLUMNS, type RawParticipant } from "@/lib/documents/server";
import { createClient } from "@/lib/supabase/server";

import { EDITABLE_STATUSES, isUuid } from "../_lib/access";
import { CompletedClient, type CompletedDoc } from "./completed-client";

type CompletedRow = Omit<CompletedDoc, "inPersonPending"> & { owner_id: string; participants: RawParticipant[] | null };

/** The document the wizard just sent (RLS: members of the workspace). */
const loadCompletedDoc = cache(async (wid: string, docId: unknown): Promise<CompletedRow | null> => {
  if (!isUuid(docId)) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("documents")
    .select(`id, title, status, request_type, scheduled_at, owner_id, participants(${PARTICIPANT_COLUMNS})`)
    .eq("id", docId)
    .eq("workspace_id", wid)
    .maybeSingle();
  return (data as CompletedRow | null) ?? null;
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
  const { profile, role } = await getWorkspaceContext(wid); // 404 for non-members

  const row = await loadCompletedDoc(wid, docParam);
  // not sent yet (e.g. opened by URL) → back to the last wizard step instead of a false "전송 완료"
  if (row && EDITABLE_STATUSES.includes(row.status)) redirect(`/workspaces/${wid}/documents/d/${row.id}/steps/3`);

  const doc: CompletedDoc | null = row
    ? {
        id: row.id,
        title: row.title,
        status: row.status,
        request_type: row.request_type,
        scheduled_at: row.scheduled_at,
        // 직접 대면 signers whose turn it is: the requester starts their signing on this device
        inPersonPending: inPersonPending(row, row.participants ?? [], canManage(row, { userId: profile.id, role })),
      }
    : null;
  return <CompletedClient wid={wid} doc={doc} />;
}
