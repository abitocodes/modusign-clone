"use client";

import { BellRing, CircleAlert, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/controls";
import { SearchInput } from "@/components/ui/input";
import { Cell, EmptyRows, FilterBar, ListPage, ListTitle, Pagination, paginate, TableHeader, TableRow, type Column } from "@/components/ui/list-page";
import { ConfirmModal } from "@/components/ui/modal";
import { viewerHref } from "@/lib/documents/view";
import type { RequestType } from "@/lib/types";

import { sendReminders } from "../actions";
import { EmptyDocumentsIllustration } from "../_components/empty-illustration";
import { LocalTime } from "../_components/local-time";

export interface ReminderRow {
  id: string;
  title: string;
  request_type: RequestType;
  requester: { name: string; email: string } | null;
  requested_at: string | null;
  participantNames: string[];
  pending: { id: string; name: string; email: string | null; sendable: boolean }[];
  expires_at: string | null;
  last_reminded_at: string | null;
}

const BATCH = 100;

const COLUMNS: Column[] = [
  { key: "title", label: "문서 제목" },
  { key: "pending", label: "서명 대기 중" },
  { key: "requested", label: "요청일", width: 120 },
  { key: "expires", label: "서명 기한", width: 140 },
  { key: "reminded", label: "마지막 리마인드", width: 140 },
  { key: "action", label: "", width: 140, align: "right" },
];

export function RemindersView({ wid, rows, loadError }: { wid: string; rows: ReminderRow[]; loadError: string | null }) {
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(10);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [sendingIds, setSendingIds] = useState<string[]>([]);
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [, startAction] = useTransition();

  const needle = query.trim().toLowerCase();
  const filtered = needle
    ? rows.filter(
        (r) =>
          r.title.toLowerCase().includes(needle) ||
          r.pending.some((p) => p.name.toLowerCase().includes(needle) || (p.email ?? "").toLowerCase().includes(needle)),
      )
    : rows;
  const { pageRows, pageCount, page: current } = paginate(filtered, page, size);
  const sendable = (r: ReminderRow) => r.pending.some((p) => p.sendable);
  const selectedIds = filtered.filter((r) => selected.has(r.id) && sendable(r)).map((r) => r.id);
  const selectableOnPage = pageRows.filter(sendable);
  const allOnPage = selectableOnPage.length > 0 && selectableOnPage.every((r) => selected.has(r.id));

  const send = (ids: string[]) => {
    if (!ids.length) return;
    setSendingIds((cur) => [...cur, ...ids]);
    startAction(async () => {
      try {
        // the server action accepts at most 100 documents per call
        let documents = 0;
        let sent = 0;
        let lastError: string | null = null;
        for (let i = 0; i < ids.length; i += BATCH) {
          const res = await sendReminders(wid, ids.slice(i, i + BATCH));
          if (res.ok) {
            documents += res.documents;
            sent += res.sent;
          } else lastError = res.error;
        }
        if (sent > 0) {
          toast.success(`문서 ${documents}건, ${sent}명에게 리마인드를 보냈습니다.`);
          setSelected((cur) => {
            const next = new Set(cur);
            ids.forEach((id) => next.delete(id));
            return next;
          });
        } else toast.error(lastError ?? "리마인드를 보내지 못했습니다.");
      } catch {
        toast.error("리마인드를 보내지 못했습니다. 잠시 후 다시 시도하세요.");
      } finally {
        setSendingIds((cur) => cur.filter((id) => !ids.includes(id)));
      }
    });
  };

  return (
    <ListPage>
      <ListTitle
        title="리마인더"
        actions={
          <Button
            variant="primary"
            icon={<BellRing className="size-4" />}
            disabled={!selectedIds.length || sendingIds.length > 0}
            onClick={() => setConfirmBulk(true)}
          >
            선택한 문서에 리마인드 보내기{selectedIds.length ? ` (${selectedIds.length})` : ""}
          </Button>
        }
      />
      <p className="mt-2 text-sm text-fg-muted">서명을 기다리는 문서의 참여자에게 서명 요청 알림 메일을 다시 보냅니다.</p>

      <FilterBar>
        <SearchInput
          aria-label="문서 제목 또는 서명자로 찾기"
          wrapperClassName="w-[320px]"
          placeholder="문서 제목, 서명자 이름·이메일로 찾기"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onSearch={() => {
            setQuery(q);
            setPage(1);
          }}
        />
        <span className="ml-auto pr-1 text-[13px] text-fg-muted">
          리마인드 대상 <strong className="font-bold text-fg">{filtered.length}</strong>건
        </span>
      </FilterBar>

      <div role="table" aria-label="리마인드 대상 문서">
        <TableHeader
          className="mt-4 h-[38px] border-line-strong"
          columns={COLUMNS}
          leading={
            <Checkbox
              aria-label="현재 페이지 전체 선택"
              checked={allOnPage}
              disabled={!selectableOnPage.length}
              onChange={(on) =>
                setSelected((cur) => {
                  const next = new Set(cur);
                  selectableOnPage.forEach((r) => (on ? next.add(r.id) : next.delete(r.id)));
                  return next;
                })
              }
            />
          }
        />
        {loadError ? (
          <EmptyRows>
            <CircleAlert className="mb-3 size-8 text-negative" />
            <p className="font-bold text-fg-2">{loadError}</p>
          </EmptyRows>
        ) : filtered.length === 0 ? (
          <EmptyRows>
            <EmptyDocumentsIllustration className="mb-4" />
            <p className="font-bold text-fg-2">{needle ? "검색 결과가 없습니다." : "리마인드를 보낼 문서가 없습니다."}</p>
            <p className="mt-1">{needle ? "다른 검색어로 찾아보세요." : "서명을 기다리는 문서가 생기면 이곳에 표시됩니다."}</p>
          </EmptyRows>
        ) : (
          pageRows.map((r) => {
            const busy = sendingIds.includes(r.id);
            const canSend = sendable(r);
            return (
              <TableRow
                key={r.id}
                className="min-h-[72px] py-2"
                leading={
                  <Checkbox
                    aria-label={`${r.title} 선택`}
                    checked={selected.has(r.id)}
                    disabled={!canSend}
                    onChange={(on) =>
                      setSelected((cur) => {
                        const next = new Set(cur);
                        if (on) next.add(r.id);
                        else next.delete(r.id);
                        return next;
                      })
                    }
                  />
                }
              >
                <Cell>
                  <Link href={viewerHref(wid, r.id)} className="block truncate text-sm font-bold text-fg hover:underline" title={r.title}>
                    {r.title}
                  </Link>
                  <p className="mt-0.5 truncate text-[13px] text-fg-muted">
                    {r.requester ? `요청자 ${r.requester.name}` : ""}
                    {r.participantNames.length ? ` · ${r.participantNames.join(",")}` : ""}
                  </p>
                </Cell>
                <Cell className="text-[13px]">
                  {r.pending.map((p) => (
                    <span key={p.id} className="block truncate text-fg-2" title={p.email ?? undefined}>
                      <span className="font-bold text-emphasis">{p.name || p.email}</span>
                      {p.email && <span className="text-fg-muted"> ({p.email})</span>}
                      {!p.sendable && <span className="text-fg-faint"> · 메일 발송 불가</span>}
                    </span>
                  ))}
                </Cell>
                <Cell width={120} className="text-[13px] text-fg-muted">
                  <LocalTime iso={r.requested_at} />
                </Cell>
                <Cell width={140} className="text-[13px] text-fg-muted">
                  <LocalTime iso={r.expires_at} variant="dash" />
                </Cell>
                <Cell width={140} className="text-[13px] text-fg-muted">
                  <LocalTime iso={r.last_reminded_at} variant="dash" empty="보낸 적 없음" />
                </Cell>
                <Cell width={140} align="right">
                  <Button
                    size="sm"
                    variant="outline"
                    icon={busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <BellRing className="size-3.5" />}
                    disabled={busy || !canSend}
                    onClick={() => send([r.id])}
                  >
                    {busy ? "보내는 중" : "리마인드 보내기"}
                  </Button>
                </Cell>
              </TableRow>
            );
          })
        )}
      </div>

      {filtered.length > 0 && (
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

      <ConfirmModal
        open={confirmBulk}
        onClose={() => setConfirmBulk(false)}
        title="리마인드를 보낼까요?"
        description={`선택한 문서 ${selectedIds.length}건의 서명 대기 참여자에게 알림 메일을 다시 보냅니다.`}
        confirmLabel="보내기"
        onConfirm={() => send(selectedIds)}
      />
    </ListPage>
  );
}
