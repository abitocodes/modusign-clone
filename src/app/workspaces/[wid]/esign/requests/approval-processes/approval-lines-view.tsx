"use client";

import { Eye, Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { ApproverTrail } from "@/components/tools/approval-status";
import { RowMenu } from "@/components/tools/row-menu";
import { FilterChip } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { MenuItem } from "@/components/ui/menu";
import { ConfirmModal } from "@/components/ui/modal";
import type { ApprovalLineRecord, MemberOption } from "@/lib/tools/approvals";
import { fmtShort } from "@/lib/utils";

import { deleteApprovalLine } from "./actions";
import { ApprovalLineModal } from "./approval-line-modal";

const COLUMNS: Column[] = [
  { key: "name", label: "결재선 명" },
  { key: "created", label: "생성 시각", width: 120 },
  { key: "activity", label: "마지막 활동 시각", width: 124 },
  { key: "menu", label: "추가 메뉴", width: 84, align: "center" },
];

export function ApprovalLinesView({
  wid,
  userId,
  canManageAll,
  lines,
  members,
}: {
  wid: string;
  userId: string;
  canManageAll: boolean;
  lines: ApprovalLineRecord[];
  members: MemberOption[];
}) {
  const [scope, setScope] = useState<"all" | "mine">("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [editor, setEditor] = useState<{ line: ApprovalLineRecord | null } | null>(null);
  const [toDelete, setToDelete] = useState<ApprovalLineRecord | null>(null);
  const [, startDelete] = useTransition();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return lines.filter((l) => (scope === "all" || l.owner_id === userId) && (!q || l.name.toLowerCase().includes(q)));
  }, [lines, scope, query, userId]);
  const { pageRows, pageCount, page: current } = paginate(filtered, page, pageSize);
  const canEdit = (l: ApprovalLineRecord) => canManageAll || l.owner_id === userId;

  const runDelete = (l: ApprovalLineRecord) =>
    startDelete(async () => {
      const res = await deleteApprovalLine(wid, l.id);
      if (!res.ok) toast.error(res.error);
      else toast.success(`'${l.name}' 결재선을 삭제했습니다.`);
    });

  const editorLine = editor?.line ?? null;

  return (
    <ListPage>
      <ListTitle
        title="결재선"
        chips={
          <>
            <FilterChip
              active={scope === "all"}
              onClick={() => {
                setScope("all");
                setPage(1);
              }}
            >
              전체
            </FilterChip>
            <FilterChip
              active={scope === "mine"}
              onClick={() => {
                setScope("mine");
                setPage(1);
              }}
            >
              내 결재선
            </FilterChip>
          </>
        }
        actions={
          <Button variant="neutral" icon={<Plus className="size-4" />} onClick={() => setEditor({ line: null })}>
            결재선 추가
          </Button>
        }
      />

      <FilterBar>
        <SearchInput
          aria-label="제목으로 검색"
          placeholder="제목으로 검색"
          wrapperClassName="w-[240px]"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(1);
          }}
        />
      </FilterBar>

      <div role="table" aria-label="결재선 목록">
        <TableHeader columns={COLUMNS} />
        {filtered.length === 0 ? (
          <EmptyRows className="min-h-[200px]">{query.trim() ? "검색 결과가 없습니다." : "결재선이 없습니다."}</EmptyRows>
        ) : (
          pageRows.map((l) => (
            <TableRow key={l.id} onClick={() => setEditor({ line: l })}>
              <Cell>
                <p className="truncate text-fg">{l.name}</p>
                <div className="mt-1 flex items-center gap-2">
                  <span className="shrink-0 text-xs text-fg-faint">결재자 {l.approvers.length}명</span>
                  <ApproverTrail approvers={l.approvers.map((a) => ({ ...a, status: "waiting" as const }))} className="text-fg-muted" />
                </div>
              </Cell>
              <Cell width={120} className="text-[13px] text-fg-2">
                {fmtShort(l.created_at)}
              </Cell>
              <Cell width={124} className="text-[13px] text-fg-2">
                {fmtShort(l.last_activity_at ?? l.updated_at)}
              </Cell>
              <Cell width={84} align="center">
                <RowMenu label={`${l.name} 추가 메뉴`}>
                  {(close) =>
                    canEdit(l) ? (
                      <>
                        <MenuItem
                          icon={<Pencil />}
                          onClick={() => {
                            close();
                            setEditor({ line: l });
                          }}
                        >
                          수정
                        </MenuItem>
                        <MenuItem
                          icon={<Trash2 />}
                          danger
                          onClick={() => {
                            close();
                            setToDelete(l);
                          }}
                        >
                          삭제
                        </MenuItem>
                      </>
                    ) : (
                      <MenuItem
                        icon={<Eye />}
                        onClick={() => {
                          close();
                          setEditor({ line: l });
                        }}
                      >
                        보기
                      </MenuItem>
                    )
                  }
                </RowMenu>
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

      {editor && (
        <ApprovalLineModal
          key={editorLine?.id ?? "new"}
          wid={wid}
          line={editorLine}
          members={members}
          readOnly={!!editorLine && !canEdit(editorLine)}
          onClose={() => setEditor(null)}
        />
      )}
      <ConfirmModal
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={() => toDelete && runDelete(toDelete)}
        title="결재선을 삭제할까요?"
        description={
          toDelete ? (
            <>
              <b className="font-bold text-fg">{toDelete.name}</b> 결재선을 삭제합니다.
              <br />이미 진행 중인 결재에는 영향을 주지 않습니다.
            </>
          ) : undefined
        }
        confirmLabel="삭제"
        danger
      />
    </ListPage>
  );
}
