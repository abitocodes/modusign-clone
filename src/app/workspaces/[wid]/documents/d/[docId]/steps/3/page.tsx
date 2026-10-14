import type { Metadata } from "next";
import { redirect } from "next/navigation";

import type { DocumentAttachment, DocumentCc, Label, Participant } from "@/lib/types";

import { loadEditableDocument } from "../../../_lib/access";
import { SettingsClient, type ConfirmParticipant } from "./settings-client";

export const metadata: Metadata = { title: "요청 정보 | OpenSign" };

export default async function RequestSettingsStepPage({ params }: PageProps<"/workspaces/[wid]/documents/d/[docId]/steps/3">) {
  const { wid, docId } = await params;
  const { supabase, doc } = await loadEditableDocument(wid, docId);
  if (!doc.file_path) redirect(`/workspaces/${wid}/documents/d/upload`);

  const [{ data: parts }, { data: labels }] = await Promise.all([
    supabase.from("participants").select("id, name, email, delivery, order_index").eq("document_id", docId).order("order_index"),
    supabase.from("labels").select("*").eq("workspace_id", wid).order("name"),
  ]);

  const participants: ConfirmParticipant[] = ((parts ?? []) as Pick<Participant, "id" | "name" | "email" | "delivery">[]).map((p) => ({
    id: p.id,
    name: p.name,
    email: p.email,
    delivery: p.delivery,
  }));

  return (
    <SettingsClient
      wid={wid}
      docId={docId}
      requestType={doc.request_type}
      initial={{
        title: doc.title,
        expiresDays: doc.expires_days,
        lockPassword: doc.lock_password,
        labelIds: doc.label_ids ?? [],
        cc: (Array.isArray(doc.cc) ? doc.cc : []) as DocumentCc[],
        attachments: (Array.isArray(doc.attachments) ? doc.attachments : []) as DocumentAttachment[],
      }}
      participants={participants}
      labels={(labels ?? []) as Label[]}
    />
  );
}
