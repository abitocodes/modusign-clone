"use client";

import { FileSpreadsheet, Mail, Pencil, Plus, Smartphone, Trash2, UserRound } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { RowMenu } from "@/components/tools/row-menu";
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
import { ConfirmModal } from "@/components/ui/modal";
import { Dropdown, MenuItem } from "@/components/ui/menu";
import { CHANNEL_LABELS, type ContactChannel } from "@/lib/tools/contacts";
import type { Contact } from "@/lib/types";
import { cn, fmtDate } from "@/lib/utils";

import { deleteContacts } from "./actions";
import { ContactModal } from "./contact-modal";
import { ContactsImportModal } from "./contacts-import-modal";

const COLUMNS: Column[] = [
  { key: "name", label: "이름", width: 260 },
  { key: "channel", label: "전송 수단" },
  { key: "created", label: "생성일", width: 100 },
  { key: "menu", label: <span className="sr-only">추가 메뉴</span>, width: 40, align: "right", className: "px-0" },
];

export function AddressBookView({ wid, contacts }: { wid: string; contacts: Contact[] }) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selected, setSelected] = useState<string[]>([]);
  const [editor, setEditor] = useState<{ contact: Contact | null } | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [toDelete, setToDelete] = useState<string[] | null>(null);
  const [deleting, startDelete] = useTransition();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter((c) => c.name.toLowerCase().includes(q) || (c.company ?? "").toLowerCase().includes(q));
  }, [contacts, query]);

  const { pageRows, pageCount, page: current } = paginate(filtered, page, pageSize);
  // ignore ids of rows that no longer exist (deleted elsewhere)
  const existing = new Set(contacts.map((c) => c.id));
  const selectedIds = selected.filter((id) => existing.has(id));
  const pageIds = pageRows.map((r) => r.id);
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selectedIds.includes(id));

  const toggleAll = (on: boolean) =>
    setSelected((prev) => (on ? Array.from(new Set([...prev, ...pageIds])) : prev.filter((id) => !pageIds.includes(id))));
  const toggle = (id: string, on: boolean) => setSelected((prev) => (on ? [...prev, id] : prev.filter((x) => x !== id)));

  const runDelete = (ids: string[]) => {
    startDelete(async () => {
      const res = await deleteContacts(wid, ids);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`연락처 ${res.count}개를 삭제했습니다.`);
      setSelected((prev) => prev.filter((id) => !ids.includes(id)));
    });
  };

  return (
    <ListPage>
      <ListTitle
        title="주소록"
        actions={
          <Dropdown
            align="right"
            panelClassName="w-[180px] rounded-md"
            trigger={(open, toggleMenu) => (
              <Button
                variant="neutral"
                icon={<Plus className="size-4" />}
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={toggleMenu}
                className={cn(open && "bg-btn-hover")}
              >
                새 연락처
              </Button>
            )}
          >
            {(close) => (
              <>
                <MenuItem
                  icon={<UserRound />}
                  onClick={() => {
                    close();
                    setEditor({ contact: null });
                  }}
                >
                  한 개씩 추가
                </MenuItem>
                <MenuItem
                  icon={<FileSpreadsheet />}
                  onClick={() => {
                    close();
                    setImportOpen(true);
                  }}
                >
                  여러 개 일괄 추가
                </MenuItem>
              </>
            )}
          </Dropdown>
        }
      />

      <FilterBar className="justify-between">
        <SearchInput
          aria-label="이름 또는 회사명으로 검색"
          placeholder="이름 또는 회사명으로 검색"
          wrapperClassName="w-[232px]"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(1);
          }}
        />
        {selectedIds.length > 0 && (
          <div className="flex items-center gap-3">
            <span className="text-[13px] text-fg-2">
              <b className="font-bold text-emphasis">{selectedIds.length}</b>개 선택됨
            </span>
            <Button variant="ghost" size="sm" onClick={() => setSelected([])}>
              선택 해제
            </Button>
            <Button
              variant="danger"
              size="sm"
              icon={<Trash2 className="size-3.5" />}
              disabled={deleting}
              onClick={() => setToDelete(selectedIds)}
            >
              삭제
            </Button>
          </div>
        )}
      </FilterBar>

      <div role="table" aria-label="연락처 목록">
        <TableHeader
          columns={COLUMNS}
          leading={
            <Checkbox
              aria-label="현재 페이지의 연락처 모두 선택"
              checked={allOnPage}
              disabled={pageIds.length === 0}
              onChange={toggleAll}
            />
          }
        />
        {contacts.length === 0 ? (
          <EmptyRows className="min-h-[224px]">
            <p>연락처가 없습니다.</p>
            <p>연락처를 추가하여 서명 요청에 주소록을 이용해 보세요.</p>
          </EmptyRows>
        ) : filtered.length === 0 ? (
          <EmptyRows className="min-h-[224px]">검색 결과가 없습니다.</EmptyRows>
        ) : (
          pageRows.map((c) => (
            <TableRow
              key={c.id}
              onClick={() => setEditor({ contact: c })}
              className={cn(selectedIds.includes(c.id) && "bg-surface-3")}
              leading={
                <Checkbox aria-label={`${c.name} 선택`} checked={selectedIds.includes(c.id)} onChange={(on) => toggle(c.id, on)} />
              }
            >
              <Cell width={260}>
                <p className="truncate text-fg">{c.name}</p>
                {(c.company || c.position) && (
                  <p className="mt-0.5 truncate text-xs text-fg-muted">{[c.company, c.position].filter(Boolean).join(" · ")}</p>
                )}
              </Cell>
              <Cell>
                <ChannelList contact={c} />
              </Cell>
              <Cell width={100} className="text-[13px] text-fg-2">
                {fmtDate(c.created_at)}
              </Cell>
              <Cell width={40} align="right" className="px-0">
                <RowMenu label={`${c.name} 추가 메뉴`}>
                  {(close) => (
                    <>
                      <MenuItem
                        icon={<Pencil />}
                        onClick={() => {
                          close();
                          setEditor({ contact: c });
                        }}
                      >
                        수정
                      </MenuItem>
                      <MenuItem
                        icon={<Trash2 />}
                        danger
                        onClick={() => {
                          close();
                          setToDelete([c.id]);
                        }}
                      >
                        삭제
                      </MenuItem>
                    </>
                  )}
                </RowMenu>
              </Cell>
            </TableRow>
          ))
        )}
      </div>

      {contacts.length > 0 && (
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
      )}

      {editor && <ContactModal key={editor.contact?.id ?? "new"} wid={wid} contact={editor.contact} onClose={() => setEditor(null)} />}
      {importOpen && <ContactsImportModal wid={wid} existing={contacts} onClose={() => setImportOpen(false)} />}
      <ConfirmModal
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={() => toDelete && runDelete(toDelete)}
        title={toDelete && toDelete.length > 1 ? `연락처 ${toDelete.length}개를 삭제할까요?` : "연락처를 삭제할까요?"}
        description="삭제한 연락처는 되돌릴 수 없습니다."
        confirmLabel="삭제"
        danger
      />
    </ListPage>
  );
}

function ChannelList({ contact }: { contact: Contact }) {
  const items: { channel: ContactChannel; value: string }[] = [];
  if (contact.phone) items.push({ channel: "phone", value: contact.phone });
  if (contact.email) items.push({ channel: "email", value: contact.email });
  items.sort((a, b) => Number(b.channel === contact.default_channel) - Number(a.channel === contact.default_channel));
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-1">
      {items.map((it) => {
        const isDefault = it.channel === contact.default_channel;
        const Icon = it.channel === "phone" ? Smartphone : Mail;
        return (
          <span key={it.channel} className="inline-flex min-w-0 items-center gap-1.5">
            <Icon aria-label={CHANNEL_LABELS[it.channel]} className="size-3.5 shrink-0 text-fg-faint" />
            <span className={cn("truncate", isDefault ? "text-fg" : "text-fg-muted")}>{it.value}</span>
            {isDefault && (
              <span className="inline-flex h-[18px] shrink-0 items-center rounded-full border border-emphasis-border px-1.5 text-[11px] font-medium text-emphasis">
                기본
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}
