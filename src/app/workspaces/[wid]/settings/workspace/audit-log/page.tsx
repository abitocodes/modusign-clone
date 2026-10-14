import Link from "next/link";

import { AuditLogControls, AuditLogPager } from "@/components/settings/audit-log-controls";
import { AUDIT_EVENT_TYPES, AUDIT_PAGE_SIZE } from "@/components/settings/audit-log-types";
import { isAdminRole } from "@/components/settings/shared";
import { AdminOnlyNotice, CardTitle, SettingsCard } from "@/components/settings/ui";
import { CountPill } from "@/components/ui/badge";
import { getWorkspaceContext } from "@/lib/data/session";
import { describeEvent } from "@/lib/events";
import { createClient } from "@/lib/supabase/server";
import { fmtDashDateTime } from "@/lib/utils";

interface AuditRow {
  id: string;
  document_id: string;
  document_title: string;
  type: string;
  actor_name: string | null;
  actor_email: string | null;
  ip: string | null;
  meta: Record<string, unknown>;
  created_at: string;
  total_count: number;
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function AuditLogPage({ params, searchParams }: PageProps<"/workspaces/[wid]/settings/workspace/audit-log">) {
  const { wid } = await params;
  const sp = await searchParams;
  const ctx = await getWorkspaceContext(wid);
  if (!isAdminRole(ctx.role)) return <AdminOnlyNotice title="감사 로그" />;

  const q = first(sp.q).trim().slice(0, 100);
  const typeParam = first(sp.type);
  const type = AUDIT_EVENT_TYPES.some((t) => t.value === typeParam) ? typeParam : "";
  const page = Math.max(1, Math.min(10_000, Number.parseInt(first(sp.page), 10) || 1));

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("workspace_audit_log", {
    wid,
    q: q || null,
    etype: type || null,
    lim: AUDIT_PAGE_SIZE,
    off: (page - 1) * AUDIT_PAGE_SIZE,
  });
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as AuditRow[];
  const total = Number(rows[0]?.total_count ?? 0);
  const pageCount = Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE));
  const filtered = !!(q || type);

  return (
    <SettingsCard>
      <CardTitle
        title={
          <span className="flex items-center gap-2">
            감사 로그 {total > 0 && <CountPill>{total.toLocaleString("ko-KR")}건</CountPill>}
          </span>
        }
        description="이 워크스페이스 문서에서 발생한 서명 요청, 열람, 서명, 거절, 취소 등의 활동 기록입니다."
      />

      {/* keyed by the query so the search box resets when the URL changes (e.g. "전체 기록 보기") */}
      <AuditLogControls key={q} q={q} type={type} />

      <div role="table" aria-label="감사 로그" className="mt-[18px]">
        <div role="row" className="flex h-[50px] items-center border-b border-line px-3 text-[13px] text-fg-faint">
          <div role="columnheader" className="w-[140px] shrink-0">
            일시
          </div>
          <div role="columnheader" className="w-[200px] shrink-0 px-3">
            문서
          </div>
          <div role="columnheader" className="min-w-0 flex-1 px-3">
            활동 내용
          </div>
          <div role="columnheader" className="w-[120px] shrink-0 px-3">
            IP
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="flex min-h-[230px] flex-col items-center justify-center border-b border-line-light text-center text-sm leading-relaxed text-fg-muted">
            {filtered || page > 1 ? (
              <>
                검색 조건에 맞는 기록이 없습니다.
                <Link href={`/workspaces/${wid}/settings/workspace/audit-log`} className="mt-2 text-[13px] text-emphasis underline underline-offset-2">
                  전체 기록 보기
                </Link>
              </>
            ) : (
              <>
                아직 기록된 활동이 없습니다.
                <br />
                서명 요청을 보내면 진행 이력이 여기에 표시됩니다.
              </>
            )}
          </div>
        ) : (
          rows.map((e) => (
            <div role="row" key={e.id} className="flex min-h-14 items-center border-b border-line px-3 py-2 text-sm hover:bg-surface-3">
              <div role="cell" className="w-[140px] shrink-0 text-[13px] text-fg-muted">
                {fmtDashDateTime(e.created_at)}
              </div>
              <div role="cell" className="w-[200px] min-w-0 shrink-0 px-3">
                <Link
                  href={`/workspaces/${wid}/documents/${e.document_id}`}
                  className="block truncate text-fg-2 hover:text-fg hover:underline"
                  title={e.document_title}
                >
                  {e.document_title}
                </Link>
              </div>
              <div role="cell" className="min-w-0 flex-1 px-3 text-fg">
                <p className="break-words leading-snug">{describeEvent(e)}</p>
                <p className="mt-0.5 text-xs text-fg-faint">{AUDIT_EVENT_TYPES.find((t) => t.value === e.type)?.label ?? e.type}</p>
              </div>
              <div role="cell" className="w-[120px] shrink-0 truncate px-3 text-[13px] text-fg-muted">
                {e.meta?.auto ? "자동 진행" : (e.ip ?? "-")}
              </div>
            </div>
          ))
        )}
      </div>

      {total > AUDIT_PAGE_SIZE && <AuditLogPager page={Math.min(page, pageCount)} pageCount={pageCount} />}
    </SettingsCard>
  );
}
