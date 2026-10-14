"use client";

import { Pencil, SquarePen, Trash2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { StatusBadge, FilterChip } from "@/components/ui/badge";
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
import { MenuDivider, MenuItem } from "@/components/ui/menu";
import { ConfirmModal } from "@/components/ui/modal";
import { MAX_PDF_BYTES, paths } from "@/lib/storage";

import { newId, uploadPdf } from "../_edit-kit/client";
import { KebabMenu, LocalTime, RenameModal } from "../_edit-kit/list-ui";
import { createEditingDocument, deleteEditingDocument, renameEditingDocument } from "./actions";

export interface EditingListRow {
  id: string;
  owner_id: string;
  owner_name: string;
  title: string;
  file_name: string | null;
  status: string;
  created_at: string;
  last_activity_at: string;
}

const COLUMNS: Column[] = [
  { key: "title", label: "편집 문서 제목" },
  { key: "status", label: "상태", width: 140 },
  { key: "activity", label: "마지막 활동 시간", width: 180 },
  { key: "menu", label: "추가 메뉴", width: 80, align: "center" },
];

export function EditingList({
  wid,
  rows,
  me,
  loadError,
}: {
  wid: string;
  rows: EditingListRow[];
  me: { id: string; isAdmin: boolean };
  loadError: string | null;
}) {
  const router = useRouter();
  const [scope, setScope] = useState<"all" | "mine">("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [uploading, setUploading] = useState(false);
  const [renaming, setRenaming] = useState<EditingListRow | null>(null);
  const [deleting, setDeleting] = useState<EditingListRow | null>(null);
  const [, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const editorHref = (id: string) => `/workspaces/${wid}/esign/requests/editing-documents/${id}`;
  const canManage = (r: EditingListRow) => r.owner_id === me.id || me.isAdmin;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => (scope === "all" || r.owner_id === me.id) && (!q || r.title.toLowerCase().includes(q)));
  }, [rows, scope, query, me.id]);
  const { pageRows, pageCount, page: current } = paginate(filtered, page, pageSize);

  async function handleFile(file: File) {
    if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) {
      toast.error("PDF 파일만 업로드할 수 있습니다.");
      return;
    }
    if (file.size > MAX_PDF_BYTES) {
      toast.error("PDF 파일은 최대 10MB까지 업로드할 수 있습니다.");
      return;
    }
    setUploading(true);
    const tid = toast.loading("파일을 업로드하는 중…");
    try {
      const lib = await import("pdf-lib");
      try {
        await lib.PDFDocument.load(await file.arrayBuffer(), { updateMetadata: false });
      } catch (e) {
        throw new Error(
          e instanceof lib.EncryptedPDFError ? "암호가 걸린 PDF는 편집할 수 없습니다." : "PDF 파일을 읽을 수 없습니다. 파일을 확인해 주세요.",
        );
      }
      const id = newId();
      const uploadError = await uploadPdf(paths.editing(wid, id), file);
      if (uploadError) throw new Error("파일을 업로드하지 못했습니다.");
      const res = await createEditingDocument({ wid, id, fileName: file.name });
      if (!res.ok) throw new Error(res.error);
      toast.success("문서를 업로드했습니다.", { id: tid });
      router.push(editorHref(res.id));
    } catch (e) {
      toast.error((e as Error).message || "업로드에 실패했습니다.", { id: tid });
      setUploading(false);
    }
  }

  return (
    <ListPage>
      <ListTitle
        title="문서 편집기"
        chips={
          <>
            <FilterChip active={scope === "all"} onClick={() => { setScope("all"); setPage(1); }}>
              전체
            </FilterChip>
            <FilterChip active={scope === "mine"} onClick={() => { setScope("mine"); setPage(1); }}>
              내 문서
            </FilterChip>
          </>
        }
        actions={
          <>
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void handleFile(f);
              }}
            />
            <Button icon={<Upload className="size-4" />} disabled={uploading} onClick={() => fileRef.current?.click()}>
              {uploading ? "업로드 중…" : "파일 업로드"}
            </Button>
          </>
        }
      />

      <FilterBar>
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
      </FilterBar>

      <div role="table" aria-label="편집 문서 목록">
        <TableHeader columns={COLUMNS} />
        {loadError ? (
          <EmptyRows>
            <p>{loadError}</p>
            <button type="button" onClick={() => router.refresh()} className="mt-2 text-emphasis hover:underline">
              다시 시도
            </button>
          </EmptyRows>
        ) : pageRows.length === 0 ? (
          <EmptyRows>{query.trim() ? "검색 결과가 없습니다." : "편집된 문서가 없습니다."}</EmptyRows>
        ) : (
          pageRows.map((r) => (
            <TableRow key={r.id} onClick={() => router.push(editorHref(r.id))}>
              <Cell>
                <p className="truncate text-sm text-fg">{r.title}</p>
                <p className="mt-0.5 truncate text-[13px] text-fg-muted">
                  {r.owner_name || "알 수 없음"}
                  {r.file_name ? ` · ${r.file_name}` : ""}
                </p>
              </Cell>
              <Cell width={140}>
                {r.status === "done" ? (
                  <StatusBadge tone="positive">편집 완료</StatusBadge>
                ) : (
                  <StatusBadge tone="emphasis">편집 중</StatusBadge>
                )}
              </Cell>
              <Cell width={180} className="text-[13px] text-fg-muted">
                <LocalTime iso={r.last_activity_at} />
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
                      <MenuDivider />
                      <MenuItem icon={<Trash2 />} danger disabled={!canManage(r)} onClick={() => { close(); setDeleting(r); }}>
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
          title="이름 변경"
          label="편집 문서 제목"
          initial={renaming.title}
          onClose={() => setRenaming(null)}
          onSubmit={async (title) => {
            const res = await renameEditingDocument({ wid, id: renaming.id, title });
            if (!res.ok) {
              toast.error(res.error);
              return false;
            }
            toast.success("이름을 변경했습니다.");
            startTransition(() => router.refresh());
            return true;
          }}
        />
      )}

      <ConfirmModal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="문서를 삭제할까요?"
        description={
          <>
            <b className="font-medium text-fg">{deleting?.title}</b>
            <br />
            삭제한 편집 문서는 복구할 수 없습니다.
            <br />
            이미 만든 서명 요청 문서는 삭제되지 않습니다.
          </>
        }
        confirmLabel="삭제"
        danger
        onConfirm={() => {
          const target = deleting;
          if (!target) return;
          void deleteEditingDocument({ wid, id: target.id }).then((res) => {
            if (!res.ok) toast.error(res.error);
            else {
              toast.success("문서를 삭제했습니다.");
              startTransition(() => router.refresh());
            }
          });
        }}
      />
    </ListPage>
  );
}
