"use client";

import { CircleAlert, Download, FileSpreadsheet } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Cell, EmptyRows, FilterBar, ListPage, ListTitle, Pagination, paginate, TableHeader, TableRow, type Column } from "@/components/ui/list-page";
import { viewerHref } from "@/lib/documents/view";
import { cn, fmtDashDateTime, isoDay } from "@/lib/utils";

import { DateRangeInput } from "../_components/date-range-input";
import { EmptyDocumentsIllustration } from "../_components/empty-illustration";
import { LocalTime } from "../_components/local-time";

export type ExportPeriod = "all" | "30" | "90" | "180" | "year" | "custom";
export type ExportStatus = "all" | "in_progress" | "completed" | "rejected" | "signing_cancelled" | "request_cancelled";

export interface ExportFilters {
  period: ExportPeriod;
  status: ExportStatus;
  from: string | null;
  to: string | null;
}

export interface ExportRow {
  id: string;
  title: string;
  status: string;
  requester: string;
  signers: { name: string; email: string; status: string }[];
  requested_at: string | null;
  completed_at: string | null;
  fields: { key: string; value: string }[];
  filledCount: number;
}

const PERIOD_OPTIONS: { value: ExportPeriod; label: string }[] = [
  { value: "all", label: "전체 기간" },
  { value: "30", label: "최근 30일" },
  { value: "90", label: "최근 90일" },
  { value: "180", label: "최근 180일" },
  { value: "year", label: "올해" },
  { value: "custom", label: "직접 입력" },
];

const STATUS_OPTIONS: { value: ExportStatus; label: string }[] = [
  { value: "all", label: "전체 상태" },
  { value: "in_progress", label: "진행 중" },
  { value: "completed", label: "완료" },
  { value: "rejected", label: "서명 거절" },
  { value: "request_cancelled", label: "요청 취소" },
  { value: "signing_cancelled", label: "서명 취소" },
];

/** shared by header + rows; fixed columns shrink (to their minimum) before 제목 / 서명자 get squeezed */
const COL = {
  id: { width: 96, className: "shrink min-w-[80px] whitespace-nowrap" },
  title: { className: "min-w-[160px]" },
  status: { width: 96, className: "shrink min-w-[84px] whitespace-nowrap" },
  requester: { width: 150, className: "shrink min-w-[100px]" },
  signers: { className: "min-w-[140px]" },
  requested: { width: 108, className: "shrink min-w-[92px] whitespace-nowrap" },
  completed: { width: 108, className: "shrink min-w-[92px] whitespace-nowrap" },
  fields: { width: 72, className: "whitespace-nowrap" },
} as const;

const COLUMNS: Column[] = [
  { key: "id", label: "문서 ID", ...COL.id },
  { key: "title", label: "제목", ...COL.title },
  { key: "status", label: "상태", ...COL.status },
  { key: "requester", label: "요청자", ...COL.requester },
  { key: "signers", label: "서명자", ...COL.signers },
  { key: "requested", label: "요청일", ...COL.requested },
  { key: "completed", label: "체결일", ...COL.completed },
  { key: "fields", label: "입력란", align: "right", ...COL.fields },
];

/* ------------------------------------------------------------------ CSV */

function csvCell(v: string) {
  let s = v ?? "";
  // neutralise spreadsheet formulas (CSV injection)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildCsv(rows: ExportRow[]) {
  const maxSigners = rows.reduce((m, r) => Math.max(m, r.signers.length), 0);
  const fieldKeys: string[] = [];
  const seen = new Set<string>();
  for (const r of rows)
    for (const f of r.fields)
      if (!seen.has(f.key)) {
        seen.add(f.key);
        fieldKeys.push(f.key);
      }

  const header = ["문서 ID", "제목", "상태", "요청자"];
  for (let i = 1; i <= maxSigners; i++) header.push(`서명자${i} 이름`, `서명자${i} 이메일`, `서명자${i} 상태`);
  header.push("요청일", "체결일", ...fieldKeys);

  const lines = [header.map(csvCell).join(",")];
  for (const r of rows) {
    const cells = [r.id, r.title, r.status, r.requester];
    for (let i = 0; i < maxSigners; i++) {
      const s = r.signers[i];
      cells.push(s?.name ?? "", s?.email ?? "", s?.status ?? "");
    }
    cells.push(r.requested_at ? fmtDashDateTime(r.requested_at) : "", r.completed_at ? fmtDashDateTime(r.completed_at) : "");
    const values = new Map(r.fields.map((f) => [f.key, f.value]));
    for (const k of fieldKeys) cells.push(values.get(k) ?? "");
    lines.push(cells.map(csvCell).join(","));
  }
  // UTF-8 BOM so Excel opens the Korean text correctly
  return String.fromCharCode(0xfeff) + lines.join("\r\n") + "\r\n";
}

function downloadCsv(rows: ExportRow[]) {
  const blob = new Blob([buildCsv(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `문서데이터_${isoDay().replace(/-/g, "")}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ----------------------------------------------------------------- view */

export function DataExportView({
  wid,
  filters,
  rows,
  truncated,
  loadError,
}: {
  wid: string;
  filters: ExportFilters;
  rows: ExportRow[];
  truncated: boolean;
  loadError: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startNav] = useTransition();
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(10);
  const [period, setPeriod] = useState<ExportPeriod>(filters.period);

  const go = (patch: Partial<ExportFilters>) => {
    const next = { ...filters, ...patch };
    const qs = new URLSearchParams();
    if (next.period !== "all") qs.set("period", next.period);
    if (next.period === "custom") {
      if (next.from) qs.set("from", next.from);
      if (next.to) qs.set("to", next.to);
    }
    if (next.status !== "all") qs.set("status", next.status);
    setPage(1);
    startNav(() => router.replace(qs.size ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };

  const { pageRows, pageCount, page: current } = paginate(rows, page, size);

  return (
    <ListPage>
      <ListTitle
        title="데이터 추출"
        actions={
          <Button
            variant="primary"
            icon={<Download className="size-4" />}
            disabled={!rows.length || pending}
            onClick={() => {
              downloadCsv(rows);
              toast.success(`문서 ${rows.length}건의 데이터를 내려받았습니다.`);
            }}
          >
            CSV 다운로드
          </Button>
        }
      />
      <p className="mt-2 text-sm text-fg-muted">서명 요청한 문서의 참여자 정보와 입력란 값을 CSV 파일로 내려받을 수 있습니다.</p>

      <FilterBar>
        <span className="pl-1 pr-1 text-[13px] font-medium text-fg-muted">기간</span>
        <Select
          aria-label="기간"
          value={period}
          wrapperClassName="w-[130px]"
          onChange={(e) => {
            const v = e.target.value as ExportPeriod;
            setPeriod(v);
            if (v !== "custom") go({ period: v, from: null, to: null });
            else if (filters.from || filters.to) go({ period: v });
          }}
        >
          {PERIOD_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
        {period === "custom" && (
          <DateRangeInput
            from={filters.period === "custom" ? filters.from : null}
            to={filters.period === "custom" ? filters.to : null}
            ariaLabel="요청일 범위"
            onApply={(from, to) => go({ period: "custom", from, to })}
          />
        )}
        <span className="ml-3 pl-1 pr-1 text-[13px] font-medium text-fg-muted">상태</span>
        <Select
          aria-label="상태"
          value={filters.status}
          wrapperClassName="w-[130px]"
          onChange={(e) => go({ status: e.target.value as ExportStatus })}
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
        <span className="ml-auto pr-1 text-[13px] text-fg-muted">
          총 <strong className="font-bold text-fg">{rows.length.toLocaleString()}</strong>건
        </span>
      </FilterBar>

      <div role="table" aria-label="추출 데이터 미리보기" aria-busy={pending} className={cn("transition-opacity", pending && "pointer-events-none opacity-60")}>
        <TableHeader className="mt-4 h-[38px] border-line-strong" columns={COLUMNS} />
        {loadError ? (
          <EmptyRows>
            <CircleAlert className="mb-3 size-8 text-negative" />
            <p className="font-bold text-fg-2">{loadError}</p>
          </EmptyRows>
        ) : rows.length === 0 ? (
          <EmptyRows>
            <EmptyDocumentsIllustration className="mb-4" />
            <p className="font-bold text-fg-2">추출할 문서가 없습니다.</p>
            <p className="mt-1">기간이나 상태를 바꿔 다시 확인해 보세요.</p>
          </EmptyRows>
        ) : (
          pageRows.map((r) => (
            <TableRow key={r.id} className="min-h-[60px] py-2">
              <Cell width={COL.id.width} className={cn(COL.id.className, "font-mono text-xs text-fg-muted")}>
                <span title={r.id}>{r.id.slice(0, 8)}</span>
              </Cell>
              <Cell className={COL.title.className}>
                <Link href={viewerHref(wid, r.id)} className="block truncate font-bold text-fg hover:underline" title={r.title}>
                  {r.title}
                </Link>
              </Cell>
              <Cell width={COL.status.width} className={cn(COL.status.className, "text-[13px] text-fg-2")}>
                {r.status}
              </Cell>
              <Cell width={COL.requester.width} className={cn(COL.requester.className, "truncate text-[13px] text-fg-muted")}>
                <span title={r.requester}>{r.requester || "-"}</span>
              </Cell>
              <Cell className={cn(COL.signers.className, "text-[13px] text-fg-muted")}>
                {r.signers.length === 0
                  ? "-"
                  : r.signers.map((s, i) => (
                      <span key={i} className="block truncate" title={`${s.name} (${s.email}) · ${s.status}`}>
                        {s.name || s.email} <span className="text-fg-faint">· {s.status}</span>
                      </span>
                    ))}
              </Cell>
              <Cell width={COL.requested.width} className={cn(COL.requested.className, "text-[13px] text-fg-muted")}>
                <LocalTime iso={r.requested_at} />
              </Cell>
              <Cell width={COL.completed.width} className={cn(COL.completed.className, "text-[13px] text-fg-muted")}>
                <LocalTime iso={r.completed_at} />
              </Cell>
              <Cell width={COL.fields.width} align="right" className={cn(COL.fields.className, "text-[13px] text-fg-muted")}>
                {r.fields.length ? `${r.filledCount}/${r.fields.length}` : "-"}
              </Cell>
            </TableRow>
          ))
        )}
      </div>

      {truncated && <p className="mt-3 text-center text-xs text-fg-faint">최근 요청 문서 1,000건까지 추출됩니다. 기간을 나눠 내려받으세요.</p>}

      {rows.length > 0 && (
        <Pagination
          page={current}
          pageCount={pageCount}
          onChange={setPage}
          pageSize={size}
          onPageSizeChange={(n) => {
            setSize(n);
            setPage(1);
          }}
        />
      )}

      <div className="mt-8 flex items-start gap-2 rounded-lg border border-line bg-surface-3 p-4 text-[13px] leading-relaxed text-fg-muted">
        <FileSpreadsheet className="mt-0.5 size-4 shrink-0 text-fg-faint" />
        <p>
          CSV 파일에는 문서 ID, 제목, 상태, 요청자, 서명자(이름·이메일·상태), 요청일, 체결일과 각 입력란의 값이 담깁니다. 사인·도장과 이미지 입력란은 입력 여부만 표시됩니다.
        </p>
      </div>
    </ListPage>
  );
}
