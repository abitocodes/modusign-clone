import type { Metadata } from "next";
import { redirect } from "next/navigation";

import type { Contact, Participant, Profile } from "@/lib/types";

import { loadEditableDocument } from "../../../_lib/access";
import type { Locale, ParticipantInput, PersonSuggestion } from "../../../_lib/types";
import { ParticipantsClient } from "./participants-client";

export const metadata: Metadata = { title: "참여자 설정 | OpenSign" };

export default async function ParticipantsStepPage({ params }: PageProps<"/workspaces/[wid]/documents/d/[docId]/steps/1">) {
  const { wid, docId } = await params;
  const { supabase, doc } = await loadEditableDocument(wid, docId);
  if (!doc.file_path) redirect(`/workspaces/${wid}/documents/d/upload`);

  const [{ data: parts }, { data: fieldRows }, { data: contacts }, { data: members }] = await Promise.all([
    supabase.from("participants").select("*").eq("document_id", docId).order("order_index"),
    supabase.from("fields").select("participant_id").eq("document_id", docId),
    supabase.from("contacts").select("id, name, email, phone, company, position").eq("workspace_id", wid).order("name").limit(500),
    supabase.from("workspace_members").select("user_id, profiles(id, name, email, department, position)").eq("workspace_id", wid),
  ]);

  const participants: ParticipantInput[] = ((parts ?? []) as Participant[]).map((p) => ({
    id: p.id,
    name: p.name,
    email: p.email ?? "",
    phone: p.phone ?? "",
    delivery: p.delivery,
    locale: (["ko", "en", "ja", "zh"].includes(p.locale) ? p.locale : "ko") as Locale,
    authPassword: p.auth_password,
    message: p.message,
    requestAttachment: p.request_attachment,
    roleLabel: p.role_label ?? null,
  }));

  const fieldCounts: Record<string, number> = {};
  for (const f of (fieldRows ?? []) as { participant_id: string | null }[]) {
    if (f.participant_id) fieldCounts[f.participant_id] = (fieldCounts[f.participant_id] ?? 0) + 1;
  }

  type MemberRow = { user_id: string; profiles: Pick<Profile, "id" | "name" | "email" | "department" | "position"> | null };
  const suggestions: PersonSuggestion[] = [
    ...((members ?? []) as unknown as MemberRow[])
      .filter((m) => m.profiles)
      .map((m) => ({
        key: `m-${m.user_id}`,
        name: m.profiles!.name,
        email: m.profiles!.email,
        phone: null,
        sub: [m.profiles!.department, m.profiles!.position].filter(Boolean).join(" · ") || null,
        source: "member" as const,
      })),
    ...((contacts ?? []) as Pick<Contact, "id" | "name" | "email" | "phone" | "company" | "position">[]).map((c) => ({
      key: `c-${c.id}`,
      name: c.name,
      email: c.email,
      phone: c.phone,
      sub: [c.company, c.position].filter(Boolean).join(" · ") || null,
      source: "contact" as const,
    })),
  ];

  return (
    <ParticipantsClient
      wid={wid}
      docId={docId}
      initialRequestType={doc.request_type}
      initialSigningOrder={doc.signing_order}
      initialParticipants={participants}
      fieldCounts={fieldCounts}
      suggestions={suggestions}
    />
  );
}
