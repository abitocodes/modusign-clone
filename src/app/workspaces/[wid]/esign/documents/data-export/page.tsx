import type { Metadata } from "next";

import { getWorkspaceContext } from "@/lib/data/session";
import { loadOwners } from "@/lib/documents/server";
import { dayRangeToTimestamps, displayParticipantStatus, docProgressLabel, isIsoDay, participantStatusLabel } from "@/lib/documents/view";
import { FIELD_META } from "@/lib/fields";
import { createClient } from "@/lib/supabase/server";
import type { DocStatus, FieldRow, Participant, RequestType } from "@/lib/types";

import { DataExportView, type ExportFilters, type ExportPeriod, type ExportRow, type ExportStatus } from "./data-export-view";

export const metadata: Metadata = { title: "데이터 추출 | OpenSign" };

const MAX_ROWS = 1000;
const REQUESTED: DocStatus[] = ["in_progress", "completed", "rejected", "signing_cancelled", "request_cancelled"];
const PERIODS: ExportPeriod[] = ["all", "30", "90", "180", "year", "custom"];
const STATUSES: ExportStatus[] = ["all", ...REQUESTED] as ExportStatus[];

type RawSearch = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

function parseFilters(sp: RawSearch): ExportFilters {
  const period = one(sp.period) as ExportPeriod;
  const status = one(sp.status) as ExportStatus;
  const from = one(sp.from);
  const to = one(sp.to);
  return {
    period: PERIODS.includes(period) ? period : "all",
    status: STATUSES.includes(status) ? status : "all",
    from: isIsoDay(from) ? from : null,
    to: isIsoDay(to) ? to : null,
  };
}

/** gte timestamp for the preset periods (custom → explicit day range). */
function periodBounds(f: ExportFilters): { gte: string | null; lt: string | null } {
  if (f.period === "custom") return dayRangeToTimestamps(f.from, f.to);
  if (f.period === "all") return { gte: null, lt: null };
  const now = new Date();
  if (f.period === "year") return { gte: `${now.getFullYear()}-01-01T00:00:00+09:00`, lt: null };
  const d = new Date(now.getTime() - Number(f.period) * 24 * 60 * 60 * 1000);
  return { gte: d.toISOString(), lt: null };
}

type ExportField = Pick<FieldRow, "type" | "page" | "x" | "y" | "options" | "value" | "filled_at">;

function fieldText(f: ExportField) {
  switch (f.type) {
    case "signature":
      return f.value ? "서명 완료" : "";
    case "image":
      return f.value ? "이미지 첨부" : "";
    case "checkbox":
      return f.value === "true" ? "체크" : f.filled_at ? "체크 안 함" : "";
    default:
      return f.value ?? "";
  }
}

/** Column names for the fields of one document: custom label, else "<유형> <n>" in reading order. */
function labelFields(fields: ExportField[]) {
  const sorted = [...fields].sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);
  const counters = new Map<string, number>();
  return sorted.map((f) => {
    const custom = f.options?.label?.trim();
    const base = custom || FIELD_META[f.type].label;
    const n = (counters.get(base) ?? 0) + 1;
    counters.set(base, n);
    const key = custom ? (n === 1 ? custom : `${custom} (${n})`) : `${base} ${n}`;
    return { key, value: fieldText(f), filled: f.type === "checkbox" ? !!f.filled_at : !!f.value };
  });
}

interface Row {
  id: string;
  title: string;
  status: DocStatus;
  request_type: RequestType;
  owner_id: string;
  requested_at: string | null;
  completed_at: string | null;
  participants: Pick<Participant, "name" | "email" | "status" | "order_index">[] | null;
  fields: ExportField[] | null;
}

export default async function DataExportPage({ params, searchParams }: PageProps<"/workspaces/[wid]/esign/documents/data-export">) {
  const { wid } = await params;
  const filters = parseFilters(await searchParams);
  await getWorkspaceContext(wid);
  const supabase = await createClient();

  let query = supabase
    .from("documents")
    .select(
      `id, title, status, request_type, owner_id, requested_at, completed_at,
       participants(name, email, status, order_index),
       fields(type, page, x, y, options, value, filled_at)`,
    )
    .eq("workspace_id", wid)
    .not("requested_at", "is", null);
  query = filters.status === "all" ? query.in("status", REQUESTED) : query.eq("status", filters.status);
  const { gte, lt } = periodBounds(filters);
  if (gte) query = query.gte("requested_at", gte);
  if (lt) query = query.lt("requested_at", lt);

  const { data, error } = await query.order("requested_at", { ascending: false }).limit(MAX_ROWS);
  if (error) console.error("[data-export] query failed:", error.message);
  const docs = (data ?? []) as Row[];
  const owners = await loadOwners(
    supabase,
    docs.map((d) => d.owner_id),
  );

  const rows: ExportRow[] = docs.map((d) => {
    const owner = owners.get(d.owner_id);
    const fields = labelFields(d.fields ?? []);
    return {
      id: d.id,
      title: d.title,
      status: docProgressLabel(d.status, d.request_type),
      requester: owner ? `${owner.name} (${owner.email})` : "",
      signers: [...(d.participants ?? [])]
        .sort((a, b) => a.order_index - b.order_index)
        .map((p) => ({
          name: p.name,
          email: p.email ?? "",
          status: participantStatusLabel(displayParticipantStatus(p.status, d.status), d.request_type),
        })),
      requested_at: d.requested_at,
      completed_at: d.completed_at,
      fields: fields.map(({ key, value }) => ({ key, value })),
      filledCount: fields.filter((f) => f.filled).length,
    };
  });

  return (
    <DataExportView
      key={`${filters.period}|${filters.status}|${filters.from}|${filters.to}`}
      wid={wid}
      filters={filters}
      rows={rows}
      truncated={docs.length >= MAX_ROWS}
      loadError={error ? "문서 데이터를 불러오지 못했습니다. 잠시 후 다시 시도하세요." : null}
    />
  );
}
