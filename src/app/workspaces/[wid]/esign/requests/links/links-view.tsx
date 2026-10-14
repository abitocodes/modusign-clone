"use client";

import { Copy, ExternalLink, LoaderCircle, Plus, Power, PowerOff, Trash2 } from "lucide-react";
import { useDeferredValue, useMemo, useOptimistic, useState, useTransition } from "react";
import { toast } from "sonner";

import { copyText, LabelChips } from "@/components/templates/parts";
import { RowMenu } from "@/components/tools/row-menu";
import { FilterChip, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/input";
import { Cell, EmptyRows, FilterBar, ListPage, ListTitle, Pagination, TableHeader, TableRow, paginate, type Column } from "@/components/ui/list-page";
import { MenuDivider, MenuItem, SelectMenu } from "@/components/ui/menu";
import { ConfirmModal } from "@/components/ui/modal";
import type { TemplateOption } from "@/lib/templates/model";
import type { Label } from "@/lib/types";
import { cn, fmtDateTime } from "@/lib/utils";

import { deleteLinkSign, setLinkActive } from "./actions";
import { LinkCreateModal, LinkShareModal } from "./link-modals";

export interface LinkListItem {
  id: string;
  title: string;
  url: string;
  active: boolean;
  ownerName: string | null;
  isMine: boolean;
  canManage: boolean;
  /** null when the template is not visible to me (not shared) or was deleted */
  templateTitle: string | null;
  templateDeleted: boolean;
  labelIds: string[];
  createdAt: string;
  lastActivityAt: string;
  /** documents created through the link */
  uses: number;
}

type StatusFilter = "all" | "active" | "inactive";

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "모든 상태" },
  { value: "active", label: "활성" },
  { value: "inactive", label: "비활성" },
];

/** Column geometry shared by header and rows; fixed columns shrink so the title keeps ≥ 160px. */
const COL = {
  status: { width: 100, className: "shrink-0" },
  title: { className: "min-w-[160px]" },
  owner: { width: 140, className: "shrink min-w-[84px]" },
  labels: { width: 180, className: "shrink min-w-[96px]" },
  activity: { width: 140, className: "shrink min-w-[122px]" },
  menu: { width: 74, className: "" },
} as const;

const COLUMNS: Column[] = [
  { key: "status", label: "상태", width: COL.status.width, className: cn(COL.status.className, "whitespace-nowrap") },
  { key: "title", label: "링크 제목", className: cn(COL.title.className, "whitespace-nowrap") },
  { key: "owner", label: "생성자", width: COL.owner.width, className: cn(COL.owner.className, "whitespace-nowrap") },
  { key: "labels", label: "적용할 라벨", width: COL.labels.width, className: cn(COL.labels.className, "whitespace-nowrap") },
  { key: "activity", label: "마지막 활동 시간", width: COL.activity.width, className: cn(COL.activity.className, "whitespace-nowrap") },
  { key: "menu", label: "추가 메뉴", width: COL.menu.width, align: "right", className: "whitespace-nowrap" },
];

export function LinksView({ wid, items, labels, templates }: { wid: string; items: LinkListItem[]; labels: Label[]; templates: TemplateOption[] }) {
  const [optimistic, patch] = useOptimistic(items, (state: LinkListItem[], p: { id: string; active: boolean }) =>
    state.map((i) => (i.id === p.id ? { ...i, active: p.active } : i)),
  );
  const [scope, setScope] = useState<"all" | "mine">("all");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [createOpen, setCreateOpen] = useState(false);
  const [share, setShare] = useState<LinkListItem | null>(null);
  const [toDelete, setToDelete] = useState<LinkListItem | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    return optimistic.filter(
      (i) =>
        (scope === "all" || i.isMine) &&
        (!q || i.title.toLowerCase().includes(q)) &&
        (status === "all" || (status === "active" ? i.active : !i.active)),
    );
  }, [optimistic, scope, deferredQuery, status]);
  const { pageRows, pageCount, page: current } = paginate(filtered, page, pageSize);

  const run = (id: string, task: () => Promise<void>) => {
    setBusyId(id);
    startTransition(async () => {
      try {
        await task();
      } catch {
        toast.error("요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      } finally {
        setBusyId(null);
      }
    });
  };

  const toggle = (item: LinkListItem) => {
    if (!item.canManage) {
      toast.error("링크서명을 만든 멤버나 관리자만 상태를 바꿀 수 있습니다.");
      return;
    }
    run(item.id, async () => {
      patch({ id: item.id, active: !item.active });
      const res = await setLinkActive(wid, item.id, !item.active);
      if (!res.ok) toast.error(res.error);
      else toast.success(item.active ? "링크서명을 비활성화했습니다. 더 이상 서명을 받지 않습니다." : "링크서명을 활성화했습니다.");
    });
  };

  const copy = async (item: LinkListItem) => {
    if (await copyText(item.url)) toast.success("링크를 복사했습니다.");
    else toast.error("링크를 복사하지 못했습니다.");
  };

  const runDelete = (item: LinkListItem) =>
    run(item.id, async () => {
      const res = await deleteLinkSign(wid, item.id);
      if (!res.ok) toast.error(res.error);
      else toast.success("링크서명을 삭제했습니다.");
    });

  return (
    <ListPage>
      <ListTitle
        title="링크서명"
        chips={
          <>
            <FilterChip active={scope === "all"} onClick={() => (setScope("all"), setPage(1))}>
              전체
            </FilterChip>
            <FilterChip active={scope === "mine"} onClick={() => (setScope("mine"), setPage(1))}>
              내 링크서명
            </FilterChip>
          </>
        }
        actions={
          <Button variant="neutral" icon={<Plus className="size-4" />} onClick={() => setCreateOpen(true)}>
            링크서명 시작
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

      <div role="table" aria-label="링크서명 목록">
        <TableHeader columns={COLUMNS} className="h-[43px]" />
        {pageRows.length === 0 ? (
          <EmptyRows className="min-h-[170px] border-b-0">{items.length === 0 ? "생성된 링크서명이 없습니다." : "검색 결과가 없습니다."}</EmptyRows>
        ) : (
          pageRows.map((item) => {
            const busy = busyId === item.id;
            return (
              <TableRow key={item.id} onClick={() => setShare(item)}>
                <Cell width={COL.status.width}>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle(item);
                    }}
                    disabled={busy}
                    aria-pressed={item.active}
                    aria-label={`${item.title} ${item.active ? "활성 (눌러서 비활성화)" : "비활성 (눌러서 활성화)"}`}
                    title={item.canManage ? (item.active ? "눌러서 비활성화" : "눌러서 활성화") : undefined}
                    className={cn("rounded", item.canManage ? "cursor-pointer hover:brightness-125" : "cursor-default")}
                  >
                    <StatusBadge tone={item.active ? "positive" : "neutral"} dot={!item.active}>
                      {item.active ? "활성" : "비활성"}
                    </StatusBadge>
                  </button>
                </Cell>
                <Cell className={cn("py-2", COL.title.className)}>
                  <p className="flex items-center gap-1.5">
                    <span className="truncate font-medium text-fg" title={item.title}>
                      {item.title}
                    </span>
                    {busy && <LoaderCircle className="size-3.5 shrink-0 animate-spin text-fg-faint" aria-label="처리 중" />}
                  </p>
                  <p className={cn("mt-0.5 truncate text-xs", item.templateDeleted ? "text-warning" : "text-fg-muted")}>
                    {item.templateDeleted ? "템플릿이 삭제되어 서명을 받을 수 없습니다" : `템플릿 ${item.templateTitle ?? "(공유되지 않은 템플릿)"}`} · 서명 문서 {item.uses}건
                  </p>
                </Cell>
                <Cell width={COL.owner.width} className={cn("truncate text-[13px] text-fg-2", COL.owner.className)}>
                  {item.ownerName ?? "-"}
                </Cell>
                <Cell width={COL.labels.width} className={COL.labels.className}>
                  <LabelChips ids={item.labelIds} labels={labels} empty="-" emptyIcon={false} />
                </Cell>
                <Cell width={COL.activity.width} className={cn("whitespace-nowrap text-[13px] text-fg-2", COL.activity.className)}>
                  {fmtDateTime(item.lastActivityAt)}
                </Cell>
                <Cell width={COL.menu.width} align="right" className="flex justify-end">
                  <RowMenu label={`${item.title} 추가 메뉴`}>
                    {(close) => (
                      <>
                        <MenuItem icon={<Copy />} onClick={() => (close(), void copy(item))}>
                          링크 복사
                        </MenuItem>
                        <MenuItem
                          icon={<ExternalLink />}
                          onClick={() => {
                            close();
                            window.open(item.url, "_blank", "noopener,noreferrer");
                          }}
                        >
                          새 탭에서 열기
                        </MenuItem>
                        {item.canManage && (
                          <>
                            <MenuItem icon={item.active ? <PowerOff /> : <Power />} onClick={() => (close(), toggle(item))}>
                              {item.active ? "비활성화" : "활성화"}
                            </MenuItem>
                            <MenuDivider />
                            <MenuItem icon={<Trash2 />} danger onClick={() => (close(), setToDelete(item))}>
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

      {createOpen && <LinkCreateModal wid={wid} templates={templates} labels={labels} onClose={() => setCreateOpen(false)} />}
      {share && <LinkShareModal title={share.title} url={share.url} active={share.active} onClose={() => setShare(null)} />}
      <ConfirmModal
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={() => toDelete && runDelete(toDelete)}
        title="링크서명을 삭제할까요?"
        description={
          <>
            {toDelete && <b className="font-bold text-fg">&lsquo;{toDelete.title}&rsquo;</b>}
            <br />
            링크가 더 이상 열리지 않습니다. 링크로 이미 만들어진 문서는 문서함에 남습니다.
          </>
        }
        confirmLabel="삭제"
        danger
      />
    </ListPage>
  );
}
