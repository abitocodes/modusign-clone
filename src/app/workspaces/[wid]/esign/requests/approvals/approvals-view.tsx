"use client";

import { Ban, Download, Eye, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { ApprovalStatusBadge, ApproverTrail } from "@/components/tools/approval-status";
import { RowMenu } from "@/components/tools/row-menu";
import { FilterChip } from "@/components/ui/badge";
import { SearchInput } from "@/components/ui/input";
import {
  Cell,
  EmptyRows,
  FilterBar,
  ListPage,
  ListTitle,
  Pagination,
  TableHeader,
  TableRow,
  paginate,
  type Column,
} from "@/components/ui/list-page";
import { Dropdown, MenuDivider, MenuItem, SelectMenu } from "@/components/ui/menu";
import { ConfirmModal } from "@/components/ui/modal";
import {
  APPROVAL_FILTER_OPTIONS,
  approvalStage,
  isMyTurn,
  type ApprovalFilter,
  type ApprovalListItem,
} from "@/lib/tools/approvals";
import { cn, fmtShort } from "@/lib/utils";

import { cancelApproval, deleteApproval, getApprovalDownloadUrl } from "./actions";

const COLUMNS: Column[] = [
  { key: "status", label: "상태", width: 136 },
  { key: "title", label: "기안 제목 / 결재자" },
  { key: "drafter", label: "기안자", width: 140 },
  { key: "created", label: "생성 시각", width: 108 },
  { key: "activity", label: "마지막 활동시각", width: 112 },
  { key: "menu", label: "추가 메뉴", width: 84, align: "center" },
];

type SearchField = "title" | "drafter";
const SEARCH_FIELDS: { value: SearchField; label: string; placeholder: string }[] = [
  { value: "title", label: "제목", placeholder: "제목으로 검색" },
  { value: "drafter", label: "기안자", placeholder: "기안자로 검색" },
];

export function ApprovalsView({ wid, userId, approvals }: { wid: string; userId: string; approvals: ApprovalListItem[] }) {
  const router = useRouter();
  const [scope, setScope] = useState<"all" | "mine">("all");
  const [field, setField] = useState<SearchField>("title");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<ApprovalFilter>("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [toCancel, setToCancel] = useState<ApprovalListItem | null>(null);
  const [toDelete, setToDelete] = useState<ApprovalListItem | null>(null);
  const [, startTransition] = useTransition();

  const detailHref = (id: string) => `/workspaces/${wid}/esign/requests/approvals/${id}`;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return approvals.filter((a) => {
      if (scope === "mine" && a.drafter_id !== userId) return false;
      if (status !== "all" && approvalStage(a) !== status) return false;
      if (!q) return true;
      if (field === "title") return a.title.toLowerCase().includes(q);
      return (a.drafter?.name ?? "").toLowerCase().includes(q) || (a.drafter?.email ?? "").toLowerCase().includes(q);
    });
  }, [approvals, scope, status, query, field, userId]);
  const { pageRows, pageCount, page: current } = paginate(filtered, page, pageSize);
  const filtering = !!query.trim() || status !== "all" || scope !== "all";

  const download = (a: ApprovalListItem) =>
    startTransition(async () => {
      const res = await getApprovalDownloadUrl(wid, a.id);
      if (!res.ok) toast.error(res.error);
      else window.location.assign(res.url);
    });

  const runCancel = (a: ApprovalListItem) =>
    startTransition(async () => {
      const res = await cancelApproval(wid, a.id);
      if (!res.ok) toast.error(res.error);
      else toast.success("기안을 취소했습니다.");
    });

  const runDelete = (a: ApprovalListItem) =>
    startTransition(async () => {
      const res = await deleteApproval(wid, a.id);
      if (!res.ok) toast.error(res.error);
      else toast.success("기안을 삭제했습니다.");
    });

  const resetPage = () => setPage(1);
  const currentField = SEARCH_FIELDS.find((f) => f.value === field) ?? SEARCH_FIELDS[0];

  return (
    <ListPage>
      <ListTitle
        title="내부결재"
        chips={
          <>
            <FilterChip
              active={scope === "all"}
              onClick={() => {
                setScope("all");
                resetPage();
              }}
            >
              전체
            </FilterChip>
            <FilterChip
              active={scope === "mine"}
              onClick={() => {
                setScope("mine");
                resetPage();
              }}
            >
              내 기안
            </FilterChip>
          </>
        }
        actions={
          <Link
            href={`/workspaces/${wid}/esign/requests/approvals/new`}
            className="inline-flex h-9 items-center gap-1.5 rounded bg-btn-dark px-3.5 text-sm font-medium text-fg-2 transition-colors hover:bg-btn-hover"
          >
            <Plus className="size-4" />
            업로드로 기안 작성
          </Link>
        }
      />

      <FilterBar>
        <div className="flex h-9 items-stretch rounded shadow-input">
          <Dropdown
            panelClassName="w-full min-w-[104px]"
            trigger={(open, toggle) => (
              <button
                type="button"
                aria-label="검색 범위"
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={toggle}
                className={cn(
                  "flex h-9 w-[104px] items-center justify-between rounded-l border-r border-line-light bg-surface px-3 text-sm text-fg",
                  open && "outline outline-1 outline-emphasis",
                )}
              >
                {currentField.label}
                <svg width="10" height="6" viewBox="0 0 10 6" className="fill-icon-2" aria-hidden>
                  <path d="M0 0h10L5 6z" />
                </svg>
              </button>
            )}
          >
            {(close) =>
              SEARCH_FIELDS.map((f) => (
                <MenuItem
                  key={f.value}
                  className={cn(f.value === field && "bg-menu-hover")}
                  onClick={() => {
                    setField(f.value);
                    resetPage();
                    close();
                  }}
                >
                  {f.label}
                </MenuItem>
              ))
            }
          </Dropdown>
          <SearchInput
            aria-label={currentField.placeholder}
            placeholder={currentField.placeholder}
            wrapperClassName="w-[242px]"
            className="rounded-l-none shadow-none"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              resetPage();
            }}
          />
        </div>
        <SelectMenu
          value={status}
          options={APPROVAL_FILTER_OPTIONS}
          width={148}
          onChange={(v) => {
            setStatus(v);
            resetPage();
          }}
        />
      </FilterBar>

      <div role="table" aria-label="기안 문서 목록">
        <TableHeader columns={COLUMNS} />
        {filtered.length === 0 ? (
          <EmptyRows className="min-h-[200px]">{filtering && approvals.length > 0 ? "조건에 맞는 기안 문서가 없습니다." : "기안 문서가 없습니다."}</EmptyRows>
        ) : (
          pageRows.map((a) => {
            const mine = a.drafter_id === userId;
            const myTurn = isMyTurn(a, userId);
            const inProgress = a.status === "in_progress" || a.status === "pending";
            const deletable = mine && (a.status === "rejected" || a.status === "cancelled");
            return (
              <TableRow key={a.id} onClick={() => router.push(detailHref(a.id))}>
                <Cell width={136}>
                  <ApprovalStatusBadge approval={a} userId={userId} />
                </Cell>
                <Cell>
                  <div className="flex min-w-0 items-center gap-2">
                    <Link
                      href={detailHref(a.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="truncate text-fg hover:underline"
                    >
                      {a.title}
                    </Link>
                    {myTurn && (
                      <span className="inline-flex h-5 shrink-0 items-center rounded-full border border-warning-border bg-warning-bg px-2 text-[11px] font-medium text-warning">
                        내 결재 차례
                      </span>
                    )}
                  </div>
                  <ApproverTrail approvers={a.approvers} className="mt-1" />
                </Cell>
                <Cell width={140} className="truncate text-[13px] text-fg-2">
                  {a.drafter?.name ?? "-"}
                  {mine && <span className="ml-1 text-xs text-fg-muted">(나)</span>}
                </Cell>
                <Cell width={108} className="text-[13px] text-fg-2">
                  {fmtShort(a.created_at)}
                </Cell>
                <Cell width={112} className="text-[13px] text-fg-2">
                  {fmtShort(a.last_activity_at)}
                </Cell>
                <Cell width={84} align="center">
                  <RowMenu label={`${a.title} 추가 메뉴`}>
                    {(close) => (
                      <>
                        <MenuItem
                          icon={<Eye />}
                          onClick={() => {
                            close();
                            router.push(detailHref(a.id));
                          }}
                        >
                          {myTurn ? "결재하기" : "상세 보기"}
                        </MenuItem>
                        <MenuItem
                          icon={<Download />}
                          disabled={!a.file_path}
                          onClick={() => {
                            close();
                            download(a);
                          }}
                        >
                          원본 다운로드
                        </MenuItem>
                        {mine && inProgress && (
                          <>
                            <MenuDivider />
                            <MenuItem
                              icon={<Ban />}
                              danger
                              onClick={() => {
                                close();
                                setToCancel(a);
                              }}
                            >
                              기안 취소
                            </MenuItem>
                          </>
                        )}
                        {deletable && (
                          <>
                            <MenuDivider />
                            <MenuItem
                              icon={<Trash2 />}
                              danger
                              onClick={() => {
                                close();
                                setToDelete(a);
                              }}
                            >
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
          resetPage();
        }}
      />

      <ConfirmModal
        open={!!toCancel}
        onClose={() => setToCancel(null)}
        onConfirm={() => toCancel && runCancel(toCancel)}
        title="기안을 취소할까요?"
        description="취소하면 결재가 중단되며, 결재 대기 중인 결재자에게 취소 알림이 전송됩니다."
        confirmLabel="기안 취소"
        cancelLabel="닫기"
        danger
      />
      <ConfirmModal
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={() => toDelete && runDelete(toDelete)}
        title="기안을 삭제할까요?"
        description="삭제한 기안 문서와 진행 이력은 되돌릴 수 없습니다."
        confirmLabel="삭제"
        danger
      />
    </ListPage>
  );
}
