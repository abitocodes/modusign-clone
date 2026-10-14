import type { Metadata } from "next";

import { getWorkspaceContext } from "@/lib/data/session";
import { canManage, loadOwners, PARTICIPANT_COLUMNS, type RawParticipant } from "@/lib/documents/server";
import { createClient } from "@/lib/supabase/server";
import type { RequestType, SigningOrder } from "@/lib/types";

import { RemindersView, type ReminderRow } from "./reminders-view";

export const metadata: Metadata = { title: "리마인더 | OpenSign" };

interface Row {
  id: string;
  title: string;
  owner_id: string;
  request_type: RequestType;
  signing_order: SigningOrder;
  requested_at: string | null;
  participants: RawParticipant[] | null;
}

const chunk = <T,>(list: T[], n: number) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));

/** 리마인더: in-progress documents I can manage that still wait for someone. */
export default async function RemindersPage({ params }: PageProps<"/workspaces/[wid]/esign/documents/reminders">) {
  const { wid } = await params;
  const { profile, role } = await getWorkspaceContext(wid);
  const me = { userId: profile.id, role };
  const supabase = await createClient();

  let query = supabase
    .from("documents")
    .select(`id, title, owner_id, request_type, signing_order, requested_at, participants(${PARTICIPANT_COLUMNS})`)
    .eq("workspace_id", wid)
    .eq("status", "in_progress")
    .order("requested_at", { ascending: false })
    .limit(1000);
  if (role === "member") query = query.eq("owner_id", profile.id);
  const { data, error } = await query;
  if (error) console.error("[reminders] query failed:", error.message);

  const docs = ((data ?? []) as Row[]).filter(
    (d) => canManage(d, me) && (d.participants ?? []).some((p) => p.status === "pending"),
  );

  const lastReminded = new Map<string, string>();
  for (const ids of chunk(
    docs.map((d) => d.id),
    100,
  )) {
    const { data: events } = await supabase
      .from("document_events")
      .select("document_id, created_at")
      .eq("type", "reminded")
      .in("document_id", ids)
      .order("created_at", { ascending: false });
    for (const e of (events ?? []) as { document_id: string; created_at: string }[]) {
      if (!lastReminded.has(e.document_id)) lastReminded.set(e.document_id, e.created_at);
    }
  }

  const owners = await loadOwners(
    supabase,
    docs.map((d) => d.owner_id),
  );

  const rows: ReminderRow[] = docs.map((d) => {
    const participants = [...(d.participants ?? [])].sort((a, b) => a.order_index - b.order_index);
    const pending = participants.filter((p) => p.status === "pending");
    const expiries = pending.map((p) => p.expires_at).filter((x): x is string => !!x).sort();
    const owner = owners.get(d.owner_id);
    return {
      id: d.id,
      title: d.title,
      request_type: d.request_type,
      requester: owner ? { name: owner.name, email: owner.email } : null,
      requested_at: d.requested_at,
      participantNames: participants.map((p) => p.name || p.email || "").filter(Boolean),
      pending: pending.map((p) => ({
        id: p.id,
        name: p.name,
        email: p.email,
        sendable: !!p.email && p.delivery !== "in_person",
      })),
      expires_at: expiries[0] ?? null,
      last_reminded_at: lastReminded.get(d.id) ?? null,
    };
  });

  return <RemindersView wid={wid} rows={rows} loadError={error ? "리마인드 대상 문서를 불러오지 못했습니다." : null} />;
}
