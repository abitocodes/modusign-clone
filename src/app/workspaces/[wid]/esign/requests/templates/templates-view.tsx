"use client";

import { Copy, Eye, LoaderCircle, Pencil, Pin, PinOff, Plus, Send, Share2, Trash2, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useDeferredValue, useMemo, useOptimistic, useState, useTransition } from "react";
import { toast } from "sonner";

import { FieldPreviewModal } from "@/components/editor/field-preview-modal";
import { HelpLabel, LabelChips } from "@/components/templates/parts";
import { RowMenu } from "@/components/tools/row-menu";
import { FilterChip } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/controls";
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
import { MenuDivider, MenuItem, SelectMenu } from "@/components/ui/menu";
import { ConfirmModal } from "@/components/ui/modal";
import type { Label, RequestType } from "@/lib/types";
import { cn, fmtDateTime } from "@/lib/utils";

import { deleteTemplates, duplicateTemplate, getTemplatePreview, setTemplatePinned, setTemplateShared, type TemplatePreview } from "./actions";
import { PinnedTemplates } from "./pinned-templates";

export interface TemplateListItem {
  id: string;
  title: string;
  requestType: RequestType;
  roleNames: string[];
  fieldCount: number;
  pageCount: number;
  labelIds: string[];
  shared: boolean;
  isMine: boolean;
  /** owner or workspace admin: may edit / share / delete */
  canManage: boolean;
  ownerName: string | null;
  modifierName: string | null;
  createdAt: string;
  updatedAt: string;
  /** when I pinned it (자주 쓰는 템플릿), null = not pinned */
  pinnedAt: string | null;
  /** active 링크서명 that use this template */
  activeLinks: number;
  /** signed URL of the PDF (pinned templates only) */
  thumbUrl: string | null;
}

type SortKey = "updated" | "created";
type Patch = { id: string; pinnedAt?: string | null; shared?: boolean };

const NOWRAP = "whitespace-nowrap";
/**
 * Column geometry shared by the header and the rows (captured screen ≈ 1400px viewport). On narrower
 * screens the fixed columns shrink down to their minimum so that 제목 keeps at least 160px.
 */
const COL = {
  title: { className: "min-w-[150px]" },
  labels: { width: 170, className: "shrink min-w-[72px]" },
  shared: { width: 104, className: "shrink min-w-[72px]" },
  modifier: { width: 100, className: "shrink min-w-[76px]" },
  updated: { width: 128, className: "shrink min-w-[122px]" },
  created: { width: 128, className: "shrink min-w-[122px]" },
  menu: { width: 72, className: "" },
} as const;

const COLUMNS: Column[] = [
  { key: "title", label: "제목", className: cn(COL.title.className, NOWRAP) },
  { key: "labels", label: "라벨", width: COL.labels.width, className: cn(COL.labels.className, NOWRAP) },
  {
    key: "shared",
    label: <HelpLabel label="공유됨" tip="워크스페이스의 모든 멤버에게 공유된 템플릿입니다. 공유되지 않은 템플릿은 등록한 멤버와 관리자만 볼 수 있습니다." />,
    width: COL.shared.width,
    className: cn(COL.shared.className, "leading-tight"),
  },
  {
    key: "modifier",
    label: <HelpLabel label="마지막 수정" tip="템플릿을 마지막으로 수정한 멤버입니다." />,
    width: COL.modifier.width,
    className: cn(COL.modifier.className, "leading-tight"),
  },
  { key: "updated", label: "마지막 수정일", width: COL.updated.width, sortable: true, className: cn(COL.updated.className, NOWRAP) },
  { key: "created", label: "생성일", width: COL.created.width, sortable: true, className: cn(COL.created.className, NOWRAP) },
  { key: "menu", label: "추가 메뉴", width: COL.menu.width, align: "right", className: NOWRAP },
];

export function TemplatesView({ wid, items, labels }: { wid: string; items: TemplateListItem[]; labels: Label[] }) {
  const router = useRouter();
  const [optimistic, applyPatch] = useOptimistic(items, (state: TemplateListItem[], patch: Patch) =>
    state.map((i) => (i.id === patch.id ? { ...i, ...patch } : i)),
  );
  const [scope, setScope] = useState<"all" | "mine">("all");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [labelId, setLabelId] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "updated", dir: "desc" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selected, setSelected] = useState<string[]>([]);
  const [toDelete, setToDelete] = useState<TemplateListItem[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [preview, setPreview] = useState<TemplatePreview | null>(null);
  const [, startTransition] = useTransition();

  const pinned = useMemo(
    () => optimistic.filter((i) => i.pinnedAt).sort((a, b) => (b.pinnedAt ?? "").localeCompare(a.pinnedAt ?? "")),
    [optimistic],
  );

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    const list = optimistic.filter(
      (i) => (scope === "all" || i.isMine) && (!q || i.title.toLowerCase().includes(q)) && (!labelId || i.labelIds.includes(labelId)),
    );
    const key = sort.key === "updated" ? "updatedAt" : "createdAt";
    const dir = sort.dir === "desc" ? -1 : 1;
    return list.sort((a, b) => a[key].localeCompare(b[key]) * dir || a.title.localeCompare(b.title, "ko"));
  }, [optimistic, scope, deferredQuery, labelId, sort]);

  const { pageRows, pageCount, page: current } = paginate(filtered, page, pageSize);
  const existing = new Set(optimistic.map((i) => i.id));
  const selectedIds = selected.filter((id) => existing.has(id));
  const pageIds = pageRows.map((r) => r.id);
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selectedIds.includes(id));

  const labelOptions = useMemo(() => [{ value: "", label: "라벨 미선택" }, ...labels.map((l) => ({ value: l.id, label: l.name }))], [labels]);

  const startHref = (id: string) => `/workspaces/${wid}/templates/${id}/use`;
  const editPath = (id: string) => `/workspaces/${wid}/templates/${id}/edit`;

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

  const togglePin = (item: TemplateListItem) =>
    run(item.id, async () => {
      const next = !item.pinnedAt;
      applyPatch({ id: item.id, pinnedAt: next ? new Date().toISOString() : null });
      const res = await setTemplatePinned(wid, item.id, next);
      if (!res.ok) toast.error(res.error);
      else toast.success(next ? "자주 쓰는 템플릿으로 지정했습니다." : "자주 쓰는 템플릿에서 해제했습니다.");
    });

  const toggleShared = (item: TemplateListItem) =>
    run(item.id, async () => {
      applyPatch({ id: item.id, shared: !item.shared });
      const res = await setTemplateShared(wid, item.id, !item.shared);
      if (!res.ok) toast.error(res.error);
      else toast.success(item.shared ? "템플릿 공유를 해제했습니다." : "워크스페이스 멤버에게 템플릿을 공유했습니다.");
    });

  const duplicate = (item: TemplateListItem) =>
    run(item.id, async () => {
      const res = await duplicateTemplate(wid, item.id);
      if (!res.ok) toast.error(res.error);
      else toast.success("템플릿을 복제했습니다.", { action: { label: "수정하기", onClick: () => router.push(editPath(res.id)) } });
    });

  const openPreview = (item: TemplateListItem) =>
    run(item.id, async () => {
      const res = await getTemplatePreview(wid, item.id);
      if (!res.ok) toast.error(res.error);
      else setPreview(res.preview);
    });

  const confirmDelete = (list: TemplateListItem[]) => {
    const manageable = list.filter((i) => i.canManage);
    if (manageable.length === 0) {
      toast.error("템플릿을 등록한 멤버나 관리자만 삭제할 수 있습니다.");
      return;
    }
    setToDelete(manageable);
  };

  const runDelete = (list: TemplateListItem[]) => {
    const ids = list.map((i) => i.id);
    run(ids[0], async () => {
      const res = await deleteTemplates(wid, ids);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`템플릿 ${res.count}개를 삭제했습니다.${res.skipped ? ` (권한이 없는 ${res.skipped}개 제외)` : ""}`);
      setSelected((prev) => prev.filter((id) => !ids.includes(id)));
    });
  };

  const onSort = (key: string) => {
    if (key !== "updated" && key !== "created") return;
    setSort((s) => (s.key === key ? { key, dir: s.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" }));
    setPage(1);
  };

  const deleteLinks = toDelete?.reduce((n, i) => n + i.activeLinks, 0) ?? 0;

  return (
    <ListPage>
      <ListTitle
        title="템플릿"
        chips={
          <>
            <FilterChip active={scope === "all"} onClick={() => (setScope("all"), setPage(1))}>
              전체
            </FilterChip>
            <FilterChip active={scope === "mine"} onClick={() => (setScope("mine"), setPage(1))}>
              내 템플릿
            </FilterChip>
          </>
        }
        actions={
          <Link
            href={`/workspaces/${wid}/templates/new`}
            className="inline-flex h-9 items-center gap-1.5 rounded bg-btn-dark px-3.5 text-sm font-medium text-fg-2 transition-colors hover:bg-btn-hover"
          >
            <Plus className="size-4" />
            템플릿 등록
          </Link>
        }
      />

      <PinnedTemplates wid={wid} items={pinned} busyId={busyId} onUnpin={togglePin} />

      <FilterBar className="mt-[30px]">
        <SearchInput
          wrapperClassName="w-[350px] max-w-full"
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
          value={labelId}
          options={labelOptions}
          onChange={(v) => {
            setLabelId(v);
            setPage(1);
          }}
          width={180}
        />
      </FilterBar>

      {selectedIds.length > 0 && (
        <div className="mt-4 flex items-center gap-3 text-[13px] text-fg-2" role="status">
          <span className="font-medium">{selectedIds.length}개 선택됨</span>
          <button
            type="button"
            onClick={() => confirmDelete(optimistic.filter((i) => selectedIds.includes(i.id)))}
            className="inline-flex h-7 items-center gap-1 rounded border border-line-strong bg-btn-light px-2.5 font-medium text-negative hover:bg-btn-base"
          >
            <Trash2 className="size-3.5" />
            삭제
          </button>
          <button type="button" onClick={() => setSelected([])} className="text-fg-muted underline underline-offset-2 hover:text-fg-2">
            선택 해제
          </button>
        </div>
      )}

      <div role="table" aria-label="템플릿 목록">
        <TableHeader
          columns={COLUMNS}
          sort={sort}
          onSort={onSort}
          leading={
            <Checkbox
              aria-label="이 페이지의 템플릿 모두 선택"
              checked={allOnPage}
              disabled={pageIds.length === 0}
              onChange={(on) =>
                setSelected((prev) => (on ? Array.from(new Set([...prev, ...pageIds])) : prev.filter((id) => !pageIds.includes(id))))
              }
            />
          }
        />

        {pageRows.length === 0 ? (
          <EmptyRows className="min-h-[170px] border-b-0">
            {optimistic.length === 0 ? "등록된 템플릿이 없습니다." : "검색 결과가 없습니다."}
          </EmptyRows>
        ) : (
          pageRows.map((item) => {
            const busy = busyId === item.id;
            const checked = selectedIds.includes(item.id);
            return (
              <TableRow
                key={item.id}
                className="group"
                onClick={() => !busy && openPreview(item)}
                leading={
                  <Checkbox
                    aria-label={`${item.title} 선택`}
                    checked={checked}
                    onChange={(on) => setSelected((prev) => (on ? [...prev, item.id] : prev.filter((id) => id !== item.id)))}
                  />
                }
              >
                <Cell className={cn("py-2", COL.title.className)}>
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate font-medium text-fg" title={item.title}>
                      {item.title}
                    </span>
                    {item.requestType === "view" && (
                      <span className="shrink-0 rounded-full border border-emphasis-border bg-emphasis-bg px-1.5 text-[11px] font-medium leading-[18px] text-emphasis">
                        열람
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        togglePin(item);
                      }}
                      disabled={busy}
                      aria-pressed={!!item.pinnedAt}
                      aria-label={item.pinnedAt ? `${item.title} 고정 해제` : `${item.title} 자주 쓰는 템플릿으로 고정`}
                      title={item.pinnedAt ? "고정 해제" : "자주 쓰는 템플릿으로 고정"}
                      className={cn(
                        "flex size-7 shrink-0 items-center justify-center rounded transition-[opacity,colors] hover:bg-btn-light focus-visible:opacity-100",
                        item.pinnedAt ? "text-warning" : "text-fg-faint opacity-0 group-hover:opacity-100",
                      )}
                    >
                      <Pin className={cn("size-4", item.pinnedAt && "fill-current")} />
                    </button>
                    {busy && <LoaderCircle className="size-3.5 shrink-0 animate-spin text-fg-faint" aria-label="처리 중" />}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-fg-muted">
                    {item.roleNames.join(", ") || "역할 없음"} · {item.pageCount}페이지 · 입력란 {item.fieldCount}개
                  </p>
                </Cell>
                <Cell width={COL.labels.width} className={COL.labels.className}>
                  <LabelChips ids={item.labelIds} labels={labels} empty="-" emptyIcon={false} />
                </Cell>
                <Cell width={COL.shared.width} className={COL.shared.className}>
                  {item.shared ? (
                    <span className="inline-flex items-center gap-1 whitespace-nowrap text-[13px] text-fg-2" title="워크스페이스의 모든 멤버에게 공유됨">
                      <Users className="size-3.5 text-fg-3" />
                      전체 멤버
                    </span>
                  ) : (
                    <span className="text-[13px] text-fg-muted">-</span>
                  )}
                </Cell>
                <Cell width={COL.modifier.width} className={cn("truncate text-[13px] text-fg-2", COL.modifier.className)}>
                  {item.modifierName ?? "-"}
                </Cell>
                <Cell width={COL.updated.width} className={cn("whitespace-nowrap text-[13px] text-fg-2", COL.updated.className)}>
                  {fmtDateTime(item.updatedAt)}
                </Cell>
                <Cell width={COL.created.width} className={cn("whitespace-nowrap text-[13px] text-fg-2", COL.created.className)}>
                  {fmtDateTime(item.createdAt)}
                </Cell>
                <Cell width={COL.menu.width} align="right" className="flex justify-end">
                  <RowMenu label={`${item.title} 추가 메뉴`}>
                    {(close) => (
                      <>
                        <MenuItem icon={<Send />} onClick={() => (close(), router.push(startHref(item.id)))}>
                          사용하기
                        </MenuItem>
                        <MenuItem icon={<Eye />} onClick={() => (close(), openPreview(item))}>
                          미리보기
                        </MenuItem>
                        {item.canManage && (
                          <MenuItem icon={<Pencil />} onClick={() => (close(), router.push(editPath(item.id)))}>
                            수정
                          </MenuItem>
                        )}
                        <MenuItem icon={<Copy />} onClick={() => (close(), duplicate(item))}>
                          복제
                        </MenuItem>
                        <MenuItem icon={item.pinnedAt ? <PinOff /> : <Pin />} onClick={() => (close(), togglePin(item))}>
                          {item.pinnedAt ? "고정 해제" : "고정"}
                        </MenuItem>
                        {item.canManage && (
                          <MenuItem icon={<Share2 />} onClick={() => (close(), toggleShared(item))}>
                            {item.shared ? "공유 해제" : "멤버에게 공유"}
                          </MenuItem>
                        )}
                        {item.canManage && (
                          <>
                            <MenuDivider />
                            <MenuItem icon={<Trash2 />} danger onClick={() => (close(), confirmDelete([item]))}>
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

      <ConfirmModal
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={() => toDelete && runDelete(toDelete)}
        title={toDelete && toDelete.length > 1 ? `템플릿 ${toDelete.length}개를 삭제할까요?` : "템플릿을 삭제할까요?"}
        description={
          <>
            {toDelete && toDelete.length === 1 && <b className="font-bold text-fg">&lsquo;{toDelete[0].title}&rsquo;</b>}
            {toDelete && toDelete.length === 1 && <br />}
            삭제한 템플릿은 되돌릴 수 없습니다. 이미 보낸 문서에는 영향이 없습니다.
            {deleteLinks > 0 && (
              <>
                <br />
                <span className="text-warning">이 템플릿을 쓰는 활성 링크서명 {deleteLinks}개는 더 이상 서명을 받을 수 없습니다.</span>
              </>
            )}
          </>
        }
        confirmLabel="삭제"
        danger
      />

      {preview && (
        <FieldPreviewModal
          open
          onClose={() => setPreview(null)}
          pdfUrl={preview.pdfUrl}
          pageSizes={preview.pageSizes}
          participants={preview.participants}
          fields={preview.fields}
        />
      )}
    </ListPage>
  );
}
