"use client";

import { ListChecks, LoaderCircle, Play, Plus, Trash2 } from "lucide-react";
import { useCallback, useDeferredValue, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { DateRangeInput } from "@/app/workspaces/[wid]/esign/documents/_components/date-range-input";
import { RowMenu } from "@/components/tools/row-menu";
import { FilterChip, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/input";
import { Cell, EmptyRows, FilterBar, ListPage, ListTitle, Pagination, TableHeader, TableRow, paginate, type Column } from "@/components/ui/list-page";
import { MenuDivider, MenuItem, SelectMenu } from "@/components/ui/menu";
import { ConfirmModal } from "@/components/ui/modal";
import { BULK_STATUS_LABEL, type BulkSummary, type TemplateOption } from "@/lib/templates/model";
import { cn, fmtDateTime, isoDay } from "@/lib/utils";

import { deleteBulkSend, getBulkDetail, processBulkSend, type BulkDetail } from "./actions";
import { BulkCreateModal } from "./bulk-create-modal";
import { BULK_TONE, BulkDetailModal } from "./bulk-detail-modal";

export interface BulkListItem {
  id: string;
  title: string;
  status: BulkSummary["status"];
  ownerName: string | null;
  isMine: boolean;
  canManage: boolean;
  templateTitle: string | null;
  createdAt: string;
  sentAt: string | null;
  total: number;
  sent: number;
  failed: number;
  /** pending + processing recipients */
  open: number;
}

type StatusFilter = "all" | BulkSummary["status"];
type SortKey = "title" | "created";
interface Run {
  summary: BulkSummary;
  error: string | null;
  running: boolean;
}

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "모든 상태" },
  { value: "pending", label: "전송 대기" },
  { value: "sending", label: "전송 중" },
  { value: "sent", label: "전송 완료" },
  { value: "failed", label: "전송 실패" },
];

/** Column geometry shared by header and rows; fixed columns shrink so the title keeps ≥ 160px. */
const COL = {
  status: { width: 120, className: "shrink-0" },
  title: { className: "min-w-[160px]" },
  owner: { width: 140, className: "shrink min-w-[84px]" },
  created: { width: 150, className: "shrink min-w-[122px]" },
  sent: { width: 150, className: "shrink min-w-[122px]" },
  menu: { width: 74, className: "" },
} as const;

const COLUMNS: Column[] = [
  { key: "status", label: "전송 상태", width: COL.status.width, className: cn(COL.status.className, "whitespace-nowrap") },
  { key: "title", label: "대량전송 제목", sortable: true, className: cn(COL.title.className, "whitespace-nowrap") },
  { key: "owner", label: "생성자", width: COL.owner.width, className: cn(COL.owner.className, "whitespace-nowrap") },
  { key: "created", label: "생성 시각", width: COL.created.width, sortable: true, className: cn(COL.created.className, "whitespace-nowrap") },
  { key: "sent", label: "전송 시각", width: COL.sent.width, className: cn(COL.sent.className, "whitespace-nowrap") },
  { key: "menu", label: "추가 메뉴", width: COL.menu.width, align: "right", className: "whitespace-nowrap" },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function BulkView({ wid, items, templates }: { wid: string; items: BulkListItem[]; templates: TemplateOption[] }) {
  const [scope, setScope] = useState<"all" | "mine">("all");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [range, setRange] = useState<{ from: string | null; to: string | null }>({ from: null, to: null });
  const [status, setStatus] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "created", dir: "desc" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [createOpen, setCreateOpen] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<BulkDetail | null>(null);
  const [toDelete, setToDelete] = useState<BulkListItem | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [runs, setRuns] = useState<Record<string, Run>>({});
  const active = useRef(new Set<string>());
  const [, startTransition] = useTransition();

  /** Keeps calling processBulkSend until the batch is finished (resumable, one loop per batch). */
  const runBulk = useCallback(
    async (id: string, total: number, title: string) => {
      if (active.current.has(id)) return;
      active.current.add(id);
      const initial: BulkSummary = { status: "sending", total, sent: 0, failed: 0, pending: total, processing: 0 };
      setRuns((r) => ({ ...r, [id]: { summary: r[id]?.summary ?? initial, error: null, running: true } }));
      try {
        for (let guard = 0; guard < 5000; guard++) {
          const res = await processBulkSend(wid, id);
          if (!res.ok) {
            setRuns((r) => ({ ...r, [id]: { summary: r[id]?.summary ?? initial, error: res.error, running: false } }));
            toast.error(res.error);
            return;
          }
          const s = res.summary;
          const finished = s.status !== "sending";
          setRuns((r) => ({ ...r, [id]: { summary: s, error: null, running: !finished } }));
          if (finished) {
            if (s.sent > 0) toast.success(`'${title}' 대량전송을 완료했습니다. (전송 ${s.sent}건${s.failed ? ` · 실패 ${s.failed}건` : ""})`);
            else toast.error(`'${title}' 대량전송에 실패했습니다.`);
            return;
          }
          // the remaining recipients are being processed elsewhere (another tab) → poll
          if (s.pending === 0) await sleep(2000);
        }
      } catch {
        const error = "네트워크 오류로 전송이 중단되었습니다. '이어서 전송'으로 다시 시도해 주세요.";
        setRuns((r) => ({ ...r, [id]: { summary: r[id]?.summary ?? initial, error, running: false } }));
        toast.error(error);
      } finally {
        active.current.delete(id);
      }
    },
    [wid],
  );

  const merged = useMemo(
    () =>
      items.map((i) => {
        const run = runs[i.id];
        if (!run) return { ...i, running: false };
        const s = run.summary;
        // the server list may already be newer than the last summary (revalidation)
        const fromRun = s.sent + s.failed >= i.sent + i.failed;
        return fromRun
          ? { ...i, status: s.status, sent: s.sent, failed: s.failed, open: s.pending + s.processing, running: run.running }
          : { ...i, running: run.running };
      }),
    [items, runs],
  );

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    const list = merged.filter((i) => {
      if (scope === "mine" && !i.isMine) return false;
      if (q && !i.title.toLowerCase().includes(q)) return false;
      if (status !== "all" && i.status !== status) return false;
      const day = isoDay(new Date(i.createdAt));
      if (range.from && day < range.from) return false;
      if (range.to && day > range.to) return false;
      return true;
    });
    const dir = sort.dir === "desc" ? -1 : 1;
    return list.sort((a, b) =>
      sort.key === "title" ? a.title.localeCompare(b.title, "ko") * dir || b.createdAt.localeCompare(a.createdAt) : a.createdAt.localeCompare(b.createdAt) * dir,
    );
  }, [merged, scope, deferredQuery, status, range, sort]);

  const { pageRows, pageCount, page: current } = paginate(filtered, page, pageSize);

  const openDetail = (id: string) => {
    setBusyId(id);
    startTransition(async () => {
      try {
        const res = await getBulkDetail(wid, id);
        if (!res.ok) toast.error(res.error);
        else setDetail(res.detail);
      } catch {
        toast.error("대량전송 정보를 불러오지 못했습니다.");
      } finally {
        setBusyId(null);
      }
    });
  };

  const resume = (item: { id: string; total: number; title: string }) => {
    toast("남은 수신자에게 이어서 전송합니다.");
    void runBulk(item.id, item.total, item.title);
  };

  const runDelete = (item: BulkListItem) => {
    setBusyId(item.id);
    startTransition(async () => {
      try {
        const res = await deleteBulkSend(wid, item.id);
        if (!res.ok) toast.error(res.error);
        else toast.success("대량전송을 삭제했습니다.");
      } catch {
        toast.error("대량전송을 삭제하지 못했습니다.");
      } finally {
        setBusyId(null);
      }
    });
  };

  const onSort = (key: string) => {
    if (key !== "title" && key !== "created") return;
    setSort((s) => (s.key === key ? { key, dir: s.dir === "desc" ? "asc" : "desc" } : { key, dir: key === "title" ? "asc" : "desc" }));
    setPage(1);
  };

  const createdRun = createdId ? runs[createdId] : undefined;

  return (
    <ListPage>
      <ListTitle
        title="대량전송"
        chips={
          <>
            <FilterChip active={scope === "all"} onClick={() => (setScope("all"), setPage(1))}>
              전체
            </FilterChip>
            <FilterChip active={scope === "mine"} onClick={() => (setScope("mine"), setPage(1))}>
              내 대량전송
            </FilterChip>
          </>
        }
        actions={
          <Button
            variant="neutral"
            icon={<Plus className="size-4" />}
            onClick={() => {
              setCreatedId(null);
              setCreateOpen(true);
            }}
          >
            템플릿으로 대량전송
          </Button>
        }
      />

      <FilterBar>
        <SearchInput
          wrapperClassName="w-[240px] max-w-full"
          placeholder="제목으로 검색"
          aria-label="제목으로 검색"
          value={query}
          maxLength={100}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(1);
          }}
        />
        <DateRangeInput
          from={range.from}
          to={range.to}
          width={240}
          ariaLabel="생성 기간"
          onApply={(from, to) => {
            setRange({ from, to });
            setPage(1);
          }}
        />
        <SelectMenu
          value={status}
          options={STATUS_OPTIONS}
          width={151}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
        />
      </FilterBar>

      <div role="table" aria-label="대량전송 목록">
        <TableHeader columns={COLUMNS} sort={sort} onSort={onSort} className="h-[51px]" />
        {pageRows.length === 0 ? (
          <EmptyRows className="min-h-[170px] border-b-0">{items.length === 0 ? "생성된 대량전송이 없습니다." : "검색 결과가 없습니다."}</EmptyRows>
        ) : (
          pageRows.map((item) => {
            const run = runs[item.id];
            const processed = item.sent + item.failed;
            return (
              <TableRow key={item.id} onClick={() => busyId !== item.id && openDetail(item.id)}>
                <Cell width={COL.status.width}>
                  <StatusBadge tone={BULK_TONE[item.status]}>{BULK_STATUS_LABEL[item.status]}</StatusBadge>
                </Cell>
                <Cell className={cn("py-2", COL.title.className)}>
                  <p className="flex items-center gap-1.5">
                    <span className="truncate font-medium text-fg" title={item.title}>
                      {item.title}
                    </span>
                    {(busyId === item.id || item.running) && <LoaderCircle className="size-3.5 shrink-0 animate-spin text-fg-faint" aria-label="처리 중" />}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-fg-muted">
                    {item.templateTitle ?? "삭제되었거나 볼 수 없는 템플릿"} · 수신자 {item.total}명
                    {item.status === "sending" ? (
                      <span className="text-emphasis">
                        {" "}
                        · {processed}/{item.total} 처리{item.running ? " 중" : " (중단됨)"}
                      </span>
                    ) : (
                      <>
                        {" "}
                        · 전송 {item.sent}건{item.failed > 0 && <span className="text-negative"> · 실패 {item.failed}건</span>}
                      </>
                    )}
                    {run?.error && <span className="text-negative"> · {run.error}</span>}
                  </p>
                </Cell>
                <Cell width={COL.owner.width} className={cn("truncate text-[13px] text-fg-2", COL.owner.className)}>
                  {item.ownerName ?? "-"}
                </Cell>
                <Cell width={COL.created.width} className={cn("whitespace-nowrap text-[13px] text-fg-2", COL.created.className)}>
                  {fmtDateTime(item.createdAt)}
                </Cell>
                <Cell width={COL.sent.width} className={cn("whitespace-nowrap text-[13px] text-fg-2", COL.sent.className)}>
                  {fmtDateTime(item.sentAt)}
                </Cell>
                <Cell width={COL.menu.width} align="right" className="flex justify-end">
                  <RowMenu label={`${item.title} 추가 메뉴`}>
                    {(close) => (
                      <>
                        <MenuItem icon={<ListChecks />} onClick={() => (close(), openDetail(item.id))}>
                          상세 보기
                        </MenuItem>
                        {item.status === "sending" && item.canManage && !item.running && item.open > 0 && (
                          <MenuItem icon={<Play />} onClick={() => (close(), resume(item))}>
                            이어서 전송
                          </MenuItem>
                        )}
                        {item.canManage && (
                          <>
                            <MenuDivider />
                            <MenuItem icon={<Trash2 />} danger disabled={item.running} onClick={() => (close(), setToDelete(item))}>
                              삭제
                            </MenuItem>
                          </>
                        )}
                      </>
                    )}
                  </RowMenu>
                </Cell>
              </TableRow>
            );
          })
        )}
      </div>

      <Pagination
        page={current}
        pageCount={pageCount}
        onChange={setPage}
        pageSize={pageSize}
        onPageSizeChange={(n) => {
          setPageSize(n);
          setPage(1);
        }}
      />

      {createOpen && (
        <BulkCreateModal
          wid={wid}
          templates={templates}
          progress={createdId && createdRun ? { id: createdId, summary: createdRun.summary, error: createdRun.error } : null}
          onClose={() => setCreateOpen(false)}
          onCreated={(id, total, title) => {
            setCreatedId(id);
            void runBulk(id, total, title);
          }}
          onOpenDetail={(id) => {
            setCreateOpen(false);
            openDetail(id);
          }}
        />
      )}

      {detail && (
        <BulkDetailModal
          wid={wid}
          detail={detail}
          running={!!runs[detail.id]?.running}
          onClose={() => setDetail(null)}
          onResume={() => {
            const d = detail;
            setDetail(null);
            resume({ id: d.id, total: d.recipients.length, title: d.title });
          }}
        />
      )}

      <ConfirmModal
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={() => toDelete && runDelete(toDelete)}
        title="대량전송을 삭제할까요?"
        description={
          <>
            {toDelete && <b className="font-bold text-fg">&lsquo;{toDelete.title}&rsquo;</b>}
            <br />
            대량전송 기록만 삭제되며, 이미 보낸 문서는 문서함에 그대로 남습니다.
          </>
        }
        confirmLabel="삭제"
        danger
      />
    </ListPage>
  );
}
