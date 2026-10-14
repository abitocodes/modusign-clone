"use client";

import { ArrowUpRight, Copy, Pencil, Plus, SquarePen, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { FilterChip } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { MenuDivider, MenuItem } from "@/components/ui/menu";
import { ConfirmModal } from "@/components/ui/modal";

import { KebabMenu, LocalTime, RenameModal } from "../_edit-kit/list-ui";
import { createDraft, deleteDrafts, duplicateDraft, renameDraft } from "./actions";

export interface DraftListRow {
  id: string;
  owner_id: string;
  owner_name: string;
  title: string;
  created_at: string;
  updated_at: string;
}

const COLUMNS: Column[] = [
  { key: "title", label: "서식 제목" },
  { key: "created", label: "최초 작성 시각", width: 120 },
  { key: "saved", label: "마지막 저장 시각", width: 140 },
  { key: "menu", label: "추가 메뉴", width: 80, align: "center" },
];

export function DraftsList({
  wid,
  rows,
  me,
  loadError,
}: {
  wid: string;
  rows: DraftListRow[];
  me: { id: string; isAdmin: boolean };
  loadError: string | null;
}) {
  const router = useRouter();
  const [scope, setScope] = useState<"all" | "mine">("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<DraftListRow | null>(null);
  const [deleting, setDeleting] = useState<string[] | null>(null);
  const [, startTransition] = useTransition();

  const editorHref = (id: string) => `/workspaces/${wid}/esign/requests/drafts/${id}`;
  const canManage = (r: DraftListRow) => r.owner_id === me.id || me.isAdmin;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => (scope === "all" || r.owner_id === me.id) && (!q || r.title.toLowerCase().includes(q)));
  }, [rows, scope, query, me.id]);
  const { pageRows, pageCount, page: current } = paginate(filtered, page, pageSize);

  const visibleChecked = pageRows.filter((r) => checked.has(r.id));
  const allOnPage = pageRows.length > 0 && visibleChecked.length === pageRows.length;
  const selectedIds = rows.filter((r) => checked.has(r.id)).map((r) => r.id);

  const toggle = (id: string, on: boolean) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const create = async () => {
    setCreating(true);
    const res = await createDraft({ wid });
    if (!res.ok) {
      toast.error(res.error);
      setCreating(false);
      return;
    }
    router.push(editorHref(res.id));
  };

  const refresh = () => startTransition(() => router.refresh());

  return (
    <ListPage>
      <ListTitle
        title="서식 작성기"
        chips={
          <>
            <FilterChip active={scope === "all"} onClick={() => { setScope("all"); setPage(1); }}>
              전체
            </FilterChip>
            <FilterChip active={scope === "mine"} onClick={() => { setScope("mine"); setPage(1); }}>
              내 서식
            </FilterChip>
          </>
        }
        actions={
          <>
            <Button
              className="bg-line-light hover:bg-menu-hover"
              iconRight={<ArrowUpRight className="size-4" />}
              onClick={() => toast("서식 검색은 준비 중입니다.")}
            >
              서식 검색
            </Button>
            <Button icon={<Plus className="size-4" />} disabled={creating} onClick={create}>
              {creating ? "만드는 중…" : "서식 작성"}
            </Button>
          </>
        }
      />

      <FilterBar className="justify-between">
        <SearchInput
          wrapperClassName="w-[240px]"
          placeholder="제목으로 검색"
          aria-label="제목으로 검색"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(1);
          }}
        />
        {selectedIds.length > 0 && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-fg-2">
              <b className="font-bold text-emphasis">{selectedIds.length}</b>개 선택됨
            </span>
            <Button variant="light" size="sm" onClick={() => setChecked(new Set())}>
              선택 해제
            </Button>
            <Button variant="danger" size="sm" icon={<Trash2 className="size-3.5" />} onClick={() => setDeleting(selectedIds)}>
              삭제
            </Button>
          </div>
        )}
      </FilterBar>

      <div role="table" aria-label="서식 목록">
        <TableHeader
          columns={COLUMNS}
          leading={
            <Checkbox
              aria-label="현재 페이지 전체 선택"
              checked={allOnPage}
              disabled={!pageRows.length}
              onChange={(on) =>
                setChecked((prev) => {
                  const next = new Set(prev);
                  pageRows.forEach((r) => (on ? next.add(r.id) : next.delete(r.id)));
                  return next;
                })
              }
            />
          }
        />
        {loadError ? (
          <EmptyRows>
            <p>{loadError}</p>
            <button type="button" onClick={() => router.refresh()} className="mt-2 text-emphasis hover:underline">
              다시 시도
            </button>
          </EmptyRows>
        ) : pageRows.length === 0 ? (
          <EmptyRows>{query.trim() ? "검색 결과가 없습니다." : "작성된 서식이 없습니다."}</EmptyRows>
        ) : (
          pageRows.map((r) => (
            <TableRow
              key={r.id}
              onClick={() => router.push(editorHref(r.id))}
              leading={<Checkbox aria-label={`${r.title} 선택`} checked={checked.has(r.id)} onChange={(on) => toggle(r.id, on)} />}
            >
              <Cell>
                <p className="truncate text-sm text-fg">{r.title}</p>
                <p className="mt-0.5 truncate text-[13px] text-fg-muted">{r.owner_name || "알 수 없음"}</p>
              </Cell>
              <Cell width={120} className="text-[13px] text-fg-muted">
                <LocalTime iso={r.created_at} />
              </Cell>
              <Cell width={140} className="text-[13px] text-fg-muted">
                <LocalTime iso={r.updated_at} />
              </Cell>
              <Cell width={80} align="center">
                <KebabMenu>
                  {(close) => (
                    <>
                      <MenuItem icon={<SquarePen />} onClick={() => { close(); router.push(editorHref(r.id)); }}>
                        편집
                      </MenuItem>
                      <MenuItem icon={<Pencil />} disabled={!canManage(r)} onClick={() => { close(); setRenaming(r); }}>
                        이름 변경
                      </MenuItem>
                      <MenuItem
                        icon={<Copy />}
                        onClick={async () => {
                          close();
                          const res = await duplicateDraft({ wid, id: r.id });
                          if (!res.ok) toast.error(res.error);
                          else {
                            toast.success("서식을 복제했습니다.");
                            refresh();
                          }
                        }}
                      >
                        복제
                      </MenuItem>
                      <MenuDivider />
                      <MenuItem icon={<Trash2 />} danger disabled={!canManage(r)} onClick={() => { close(); setDeleting([r.id]); }}>
                        삭제
                      </MenuItem>
                    </>
                  )}
                </KebabMenu>
              </Cell>
            </TableRow>
          ))
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

      {renaming && (
        <RenameModal
          open
          label="서식 제목"
          initial={renaming.title}
          onClose={() => setRenaming(null)}
          onSubmit={async (title) => {
            const res = await renameDraft({ wid, id: renaming.id, title });
            if (!res.ok) {
              toast.error(res.error);
              return false;
            }
            toast.success("이름을 변경했습니다.");
            refresh();
            return true;
          }}
        />
      )}

      <ConfirmModal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={deleting && deleting.length > 1 ? `서식 ${deleting.length}개를 삭제할까요?` : "서식을 삭제할까요?"}
        description="삭제한 서식은 복구할 수 없습니다. 이미 만든 서명 요청 문서는 삭제되지 않습니다."
        confirmLabel="삭제"
        danger
        onConfirm={() => {
          const ids = deleting;
          if (!ids?.length) return;
          void deleteDrafts({ wid, ids }).then((res) => {
            if (!res.ok) {
              toast.error(res.error);
              return;
            }
            toast.success(
              res.skipped ? `${res.deleted}개를 삭제했습니다. 권한이 없는 ${res.skipped}개는 제외했습니다.` : "서식을 삭제했습니다.",
            );
            setChecked((prev) => {
              const next = new Set(prev);
              ids.forEach((id) => next.delete(id));
              return next;
            });
            refresh();
          });
        }}
      />
    </ListPage>
  );
}
