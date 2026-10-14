import type { Metadata } from "next";

import { getWorkspaceContext } from "@/lib/data/session";
import {
  canManage,
  dispatchScheduledSafe,
  expireOverdueSafe,
  inPersonPending,
  loadMyPendingTokens,
  loadOwners,
  PARTICIPANT_COLUMNS,
  toPublicParticipant,
  type RawParticipant,
} from "@/lib/documents/server";
import { dayRangeToTimestamps, type DocListItem } from "@/lib/documents/view";
import { createClient } from "@/lib/supabase/server";
import type { DocStatus, Label, RequestType, SigningOrder } from "@/lib/types";
import { DOC_FILTER_LABELS, docMatchesFilter, type DocFilter } from "@/lib/utils";

import { DocumentsView } from "./documents-view";
import { DATE_COLUMN, parseDocListFilters, SORT_COLUMN } from "./filters";

export const metadata: Metadata = { title: "문서함 | OpenSign" };

/** Coarse DB-side pre-filter for each sidebar status; the exact match runs in docMatchesFilter. */
const COARSE: Partial<Record<DocFilter, { status: DocStatus; type?: RequestType }>> = {
  need_signing: { status: "in_progress", type: "sign" },
  wait_for_signing: { status: "in_progress", type: "sign" },
  need_viewing: { status: "in_progress", type: "view" },
  wait_for_viewing: { status: "in_progress", type: "view" },
  signing_completed: { status: "completed", type: "sign" },
  viewing_completed: { status: "completed", type: "view" },
  rejected: { status: "rejected" },
  signing_cancelled: { status: "signing_cancelled" },
  request_cancelled: { status: "request_cancelled" },
  draft: { status: "draft" },
  on_modifying: { status: "on_modifying" },
  scheduled: { status: "scheduled" },
};

const MAX_ROWS = 2000;

interface Row {
  id: string;
  title: string;
  status: DocStatus;
  request_type: RequestType;
  signing_order: SigningOrder;
  owner_id: string;
  file_path: string | null;
  completed_file_path: string | null;
  label_ids: string[] | null;
  hidden: boolean;
  scheduled_at: string | null;
  requested_at: string | null;
  completed_at: string | null;
  last_activity_at: string;
  participants: RawParticipant[] | null;
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
const includesCI = (hay: string | null | undefined, needle: string) => !!hay && hay.toLowerCase().includes(needle);

export default async function DocumentListPage({ params, searchParams }: PageProps<"/workspaces/[wid]/esign/documents/documents">) {
  const { wid } = await params;
  const filters = parseDocListFilters(await searchParams);

  // Send scheduled documents that are due and close expired requests before listing (no cron in this app).
  await dispatchScheduledSafe(wid);
  await expireOverdueSafe(wid);

  const { profile, role } = await getWorkspaceContext(wid);
  const me = { userId: profile.id, role };
  const myEmail = profile.email.toLowerCase();
  const supabase = await createClient();

  let query = supabase
    .from("documents")
    .select(
      `id, title, status, request_type, signing_order, owner_id, file_path, completed_file_path, label_ids, hidden,
       scheduled_at, requested_at, completed_at, last_activity_at, participants(${PARTICIPANT_COLUMNS})`,
    )
    .eq("workspace_id", wid);

  const coarse = COARSE[filters.status];
  if (coarse) {
    query = query.eq("status", coarse.status);
    if (coarse.type) query = query.eq("request_type", coarse.type);
  }
  if (filters.hidden === "exclude") query = query.eq("hidden", false);
  else if (filters.hidden === "only") query = query.eq("hidden", true);
  if (filters.label) query = query.contains("label_ids", [filters.label]);
  if (filters.mine || filters.share === "mine") query = query.eq("owner_id", profile.id);
  if (filters.share === "received") query = query.neq("owner_id", profile.id);
  if (filters.q && filters.scope === "title") query = query.ilike("title", `%${escapeLike(filters.q)}%`);

  const { gte, lt } = dayRangeToTimestamps(filters.from, filters.to);
  const dateCol = DATE_COLUMN[filters.dt];
  if (gte) query = query.gte(dateCol, gte);
  if (lt) query = query.lt(dateCol, lt);

  query = query
    .order(SORT_COLUMN[filters.sort], { ascending: filters.dir === "asc", nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(MAX_ROWS);

  const [{ data, error }, { data: labelRows }] = await Promise.all([
    query,
    supabase.from("labels").select("*").eq("workspace_id", wid).order("name"),
  ]);
  if (error) console.error("[documents] list query failed:", error.message);

  const docs = (data ?? []) as Row[];
  const owners = await loadOwners(
    supabase,
    docs.map((d) => d.owner_id),
  );
  const needle = filters.q.toLowerCase();

  const matched = docs.filter((d) => {
    const participants = d.participants ?? [];
    // Drafts are personal work-in-progress: only their author sees them.
    if (d.status === "draft" && d.owner_id !== profile.id) return false;
    if (!docMatchesFilter(filters.status, d, participants, myEmail)) return false;
    // 홈 > 진행 현황 cards: documents I requested or take part in
    if (filters.involved && d.owner_id !== profile.id && !participants.some((p) => (p.email ?? "").toLowerCase() === myEmail)) return false;
    if (needle && filters.scope === "requester") {
      const o = owners.get(d.owner_id);
      if (!includesCI(o?.name, needle) && !includesCI(o?.email, needle)) return false;
    }
    if (needle && filters.scope === "signer") {
      if (!participants.some((p) => includesCI(p.name, needle) || includesCI(p.email, needle))) return false;
    }
    return true;
  });

  const pageCount = Math.max(1, Math.ceil(matched.length / filters.size));
  const page = Math.min(filters.page, pageCount);
  const visible = matched.slice((page - 1) * filters.size, page * filters.size);
  const myTokens = await loadMyPendingTokens(
    supabase,
    visible.filter((d) => d.status === "in_progress").map((d) => d.id),
  );
  const pageRows: DocListItem[] = visible.map((d) => {
    const participants = d.participants ?? [];
    const manage = canManage(d, me);
    return {
      id: d.id,
      title: d.title,
      status: d.status,
      request_type: d.request_type,
      signing_order: d.signing_order,
      owner: owners.get(d.owner_id) ?? null,
      hasOriginal: !!d.file_path,
      // the download route generates a missing completed PDF on demand
      hasCompleted: d.status === "completed" || !!d.completed_file_path,
      label_ids: d.label_ids ?? [],
      hidden: d.hidden,
      scheduled_at: d.scheduled_at,
      requested_at: d.requested_at,
      completed_at: d.completed_at,
      last_activity_at: d.last_activity_at,
      participants: participants.map(toPublicParticipant).sort((a, b) => a.order_index - b.order_index),
      myToken: myTokens.get(d.id) ?? null,
      inPersonPending: inPersonPending(d, participants, manage),
      canManage: manage,
      isOwner: d.owner_id === profile.id,
    };
  });

  return (
    <DocumentsView
      wid={wid}
      title={DOC_FILTER_LABELS[filters.status]}
      filters={{ ...filters, page }}
      rows={pageRows}
      total={matched.length}
      pageCount={pageCount}
      truncated={docs.length >= MAX_ROWS}
      labels={(labelRows ?? []) as Label[]}
      myEmail={myEmail}
      loadError={error ? "문서 목록을 불러오지 못했습니다. 잠시 후 다시 시도하세요." : null}
    />
  );
}
