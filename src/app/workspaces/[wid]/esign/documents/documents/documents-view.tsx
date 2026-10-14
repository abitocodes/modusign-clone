"use client";

import { BellRing, CircleAlert, Eye, EyeOff, FileSpreadsheet, RefreshCw } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { FilterChip } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/controls";
import { ConfirmModal } from "@/components/ui/modal";
import { EmptyRows, ListPage, ListTitle, Pagination, TableHeader } from "@/components/ui/list-page";
import type { DocListItem } from "@/lib/documents/view";
import type { Label } from "@/lib/types";
import { cn } from "@/lib/utils";

import { cancelSignRequest, deleteDraftDocument, sendReminders, setDocumentsHidden, startModifyDocument } from "../actions";
import { CancelRequestModal } from "../_components/cancel-modal";
import { EmptyDocumentsIllustration } from "../_components/empty-illustration";
import { LabelModal } from "../_components/label-modal";
import { ProgressInfoModal } from "../_components/progress-modal";

import { DOC_COLUMNS } from "./columns";
import { DocumentRow, type RowCommand } from "./document-row";
import { DocumentsFilterBar } from "./filter-bar";
import { DEFAULT_FILTERS, filtersToQuery, hasActiveFilters, type DocListFilters, type SortKey } from "./filters";

type ModalState =
  | { kind: "progress"; docId: string }
  | { kind: "cancel"; doc: DocListItem }
  | { kind: "labels"; doc: DocListItem }
  | { kind: "delete"; doc: DocListItem }
  | { kind: "modify"; doc: DocListItem }
  | null;

export function DocumentsView({
  wid,
  title,
  filters,
  rows,
  total,
  pageCount,
  truncated,
  labels,
  myEmail,
  loadError,
}: {
  wid: string;
  title: string;
  filters: DocListFilters;
  rows: DocListItem[];
  total: number;
  pageCount: number;
  truncated: boolean;
  labels: Label[];
  myEmail: string;
  loadError: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [navigating, startNav] = useTransition();
  const [acting, startAction] = useTransition();
  const [openId, setOpenId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [modal, setModal] = useState<ModalState>(null);
  const [panelExtent, setPanelExtent] = useState(0);

  const selectedIds = rows.filter((r) => selected.has(r.id)).map((r) => r.id);
  const allSelected = rows.length > 0 && selectedIds.length === rows.length;
  const activeFilters = hasActiveFilters(filters);

  const go = (patch: Partial<DocListFilters>, opts: { push?: boolean } = {}) => {
    const next: DocListFilters = { ...filters, page: 1, ...patch };
    const href = `${pathname}?${filtersToQuery(next)}`;
    setOpenId(null);
    startNav(() => (opts.push ? router.push(href) : router.replace(href, { scroll: false })));
  };

  const onSort = (key: string) => {
    const k = key as SortKey;
    go({ sort: k, dir: filters.sort === k && filters.dir === "desc" ? "asc" : "desc" });
  };

  const remind = (ids: string[]) =>
    startAction(async () => {
      const res = await sendReminders(wid, ids);
      if (res.ok) toast.success(`${res.sent}명에게 리마인드를 보냈습니다.`);
      else toast.error(res.error);
    });

  const hide = (ids: string[], hidden: boolean) =>
    startAction(async () => {
      const res = await setDocumentsHidden(wid, ids, hidden);
      if (res.ok) {
        toast.success(hidden ? `문서 ${res.count}개를 숨겼습니다.` : `문서 ${res.count}개의 숨김을 해제했습니다.`);
        setSelected(new Set());
      } else toast.error(res.error);
    });

  const onCommand = (cmd: RowCommand, doc: DocListItem) => {
    switch (cmd) {
      case "progress":
        setModal({ kind: "progress", docId: doc.id });
        break;
      case "cancel":
        setModal({ kind: "cancel", doc });
        break;
      case "labels":
        setModal({ kind: "labels", doc });
        break;
      case "delete":
        setModal({ kind: "delete", doc });
        break;
      case "modify":
        setModal({ kind: "modify", doc });
        break;
      case "remind":
        remind([doc.id]);
        break;
      case "hide":
        hide([doc.id], true);
        break;
      case "unhide":
        hide([doc.id], false);
        break;
    }
  };

  const remindable = rows.filter((r) => selected.has(r.id) && r.canManage && r.status === "in_progress").map((r) => r.id);
  const manageable = rows.filter((r) => selected.has(r.id) && r.canManage).map((r) => r.id);

  return (
    <ListPage>
      <ListTitle
        title={title}
        chips={
          <>
            <FilterChip active={!filters.mine} onClick={() => go({ mine: false })}>
              전체
            </FilterChip>
            <FilterChip active={filters.mine} onClick={() => go({ mine: true })}>
              내 문서
            </FilterChip>
          </>
        }
        actions={
          <Link
            href={`/workspaces/${wid}/esign/documents/data-export`}
            className="inline-flex h-9 items-center gap-1.5 rounded bg-btn-dark px-3.5 text-sm font-medium text-fg-2 transition-colors hover:bg-btn-hover"
          >
            <FileSpreadsheet className="size-4" />
            데이터 추출
          </Link>
        }
      />

      <DocumentsFilterBar
        key={`${filters.scope}|${filters.q}|${filters.from}|${filters.to}`}
        filters={filters}
        labels={labels}
        onChange={(patch) => go(patch)}
      />

      {selectedIds.length > 0 && (
        <div className="mt-4 flex min-h-11 flex-wrap items-center gap-2 rounded-lg border border-emphasis-border bg-emphasis-bg px-4 py-1.5 text-sm">
          <span className="font-bold text-emphasis">{selectedIds.length}개 선택됨</span>
          <div className="ml-auto flex flex-wrap gap-1.5">
            <Button size="xs" variant="outline" icon={<BellRing className="size-3.5" />} disabled={!remindable.length || acting} onClick={() => remind(remindable)}>
              리마인드 보내기
            </Button>
            <Button size="xs" variant="outline" icon={<EyeOff className="size-3.5" />} disabled={!manageable.length || acting} onClick={() => hide(manageable, true)}>
              숨기기
            </Button>
            <Button size="xs" variant="outline" icon={<Eye className="size-3.5" />} disabled={!manageable.length || acting} onClick={() => hide(manageable, false)}>
              숨김 해제
            </Button>
            <Button size="xs" variant="ghost" onClick={() => setSelected(new Set())}>
              선택 해제
            </Button>
          </div>
        </div>
      )}

      <div role="table" aria-label="문서 목록" aria-busy={navigating} className={cn("transition-opacity", navigating && "pointer-events-none opacity-60")}>
        <TableHeader
          className="mt-4 h-[38px] border-line-strong"
          columns={DOC_COLUMNS}
          sort={{ key: filters.sort, dir: filters.dir }}
          onSort={onSort}
          leading={
            <Checkbox
              aria-label="현재 페이지 문서 전체 선택"
              checked={allSelected}
              disabled={!rows.length}
              onChange={(on) => setSelected(on ? new Set(rows.map((r) => r.id)) : new Set())}
            />
          }
        />

        {loadError ? (
          <EmptyRows>
            <CircleAlert className="mb-3 size-8 text-negative" />
            <p className="font-bold text-fg-2">{loadError}</p>
            <Button size="sm" variant="outline" className="mt-4" icon={<RefreshCw className="size-3.5" />} onClick={() => router.refresh()}>
              다시 시도
            </Button>
          </EmptyRows>
        ) : rows.length === 0 ? (
          <EmptyRows>
            <EmptyDocumentsIllustration className="mb-4" />
            <p className="font-bold text-fg-2">{activeFilters ? "조건에 맞는 문서가 없습니다." : "문서가 없습니다."}</p>
            <p className="mt-1">
              {activeFilters ? "검색어나 필터를 바꿔 다시 찾아보세요." : "서명을 요청하면 이곳에서 진행 상황을 확인할 수 있습니다."}
            </p>
            {activeFilters && (
              <Button
                size="sm"
                variant="outline"
                className="mt-4"
                onClick={() => go({ ...DEFAULT_FILTERS, status: filters.status, sort: filters.sort, dir: filters.dir, size: filters.size })}
              >
                필터 초기화
              </Button>
            )}
          </EmptyRows>
        ) : (
          <div role="rowgroup" style={openId && panelExtent ? { minHeight: panelExtent } : undefined}>
            {rows.map((doc) => (
              <DocumentRow
                key={doc.id}
                wid={wid}
                doc={doc}
                labels={labels}
                myEmail={myEmail}
                open={openId === doc.id}
                modalOpen={modal !== null}
                busy={acting}
                selected={selected.has(doc.id)}
                onSelect={(on) =>
                  setSelected((cur) => {
                    const next = new Set(cur);
                    if (on) next.add(doc.id);
                    else next.delete(doc.id);
                    return next;
                  })
                }
                onToggle={() => setOpenId((cur) => (cur === doc.id ? null : doc.id))}
                onClose={() => setOpenId((cur) => (cur === doc.id ? null : cur))}
                onPanelExtent={setPanelExtent}
                onCommand={(cmd) => onCommand(cmd, doc)}
              />
            ))}
          </div>
        )}
      </div>

      {truncated && (
        <p className="mt-3 text-center text-xs text-fg-faint">최근 문서 2,000건 안에서 결과를 보여 줍니다. 필터로 범위를 좁혀 보세요.</p>
      )}

      <Pagination
        page={filters.page}
        pageCount={pageCount}
        onChange={(p) => go({ page: p }, { push: true })}
        pageSize={filters.size}
        onPageSizeChange={(n) => go({ size: n })}
      />
      <p className="sr-only" aria-live="polite">
        문서 {total}개
      </p>

      <ProgressInfoModal wid={wid} docId={modal?.kind === "progress" ? modal.docId : null} onClose={() => setModal(null)} />

      <CancelRequestModal
        key={modal?.kind === "cancel" ? modal.doc.id : "closed"}
        open={modal?.kind === "cancel"}
        title={modal?.kind === "cancel" ? modal.doc.title : ""}
        pending={acting}
        onClose={() => setModal(null)}
        onConfirm={(reason) => {
          if (modal?.kind !== "cancel") return;
          const id = modal.doc.id;
          startAction(async () => {
            const res = await cancelSignRequest(wid, id, reason);
            if (res.ok) {
              toast.success("서명 요청을 취소했습니다.");
              setModal(null);
              setOpenId(null);
            } else toast.error(res.error);
          });
        }}
      />

      <LabelModal wid={wid} doc={modal?.kind === "labels" ? modal.doc : null} labels={labels} onClose={() => setModal(null)} />

      <ConfirmModal
        open={modal?.kind === "delete"}
        onClose={() => setModal(null)}
        title="문서를 삭제할까요?"
        description={
          <>
            <strong className="text-fg">{modal?.kind === "delete" ? modal.doc.title : ""}</strong>
            <br />
            삭제한 문서는 복구할 수 없습니다.
          </>
        }
        confirmLabel="삭제"
        danger
        onConfirm={() => {
          if (modal?.kind !== "delete") return;
          const id = modal.doc.id;
          startAction(async () => {
            const res = await deleteDraftDocument(wid, id);
            if (res.ok) toast.success("문서를 삭제했습니다.");
            else toast.error(res.error);
          });
        }}
      />

      <ConfirmModal
        open={modal?.kind === "modify"}
        onClose={() => setModal(null)}
        title="문서 내용을 수정할까요?"
        description="수정하는 동안 서명 요청이 멈추고, 수정을 마친 뒤 다시 전송하면 참여자에게 새 요청이 발송됩니다."
        confirmLabel="수정하기"
        onConfirm={() => {
          if (modal?.kind !== "modify") return;
          const id = modal.doc.id;
          startAction(async () => {
            const res = await startModifyDocument(wid, id);
            if (res.ok) router.push(res.href);
            else toast.error(res.error);
          });
        }}
      />
    </ListPage>
  );
}
