"use client";

import { ExternalLink, ListChecks, Play } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { BULK_STATUS_LABEL, type BulkRecipientItem, type BulkSummary } from "@/lib/templates/model";
import type { BadgeTone } from "@/lib/utils";
import { cn, fmtDateTime } from "@/lib/utils";

import type { BulkDetail } from "./actions";

export const BULK_TONE: Record<BulkSummary["status"], BadgeTone> = {
  pending: "neutral",
  sending: "emphasis",
  sent: "positive",
  failed: "negative",
};

const RESULT: Record<BulkRecipientItem["status"], { label: string; className: string }> = {
  pending: { label: "대기", className: "text-fg-muted" },
  processing: { label: "전송 중", className: "text-emphasis" },
  sent: { label: "전송 완료", className: "text-positive" },
  failed: { label: "실패", className: "text-negative" },
};

type Filter = "all" | "sent" | "failed" | "open";

/** 대량전송 상세: recipients with their result and a link to each document. */
export function BulkDetailModal({
  wid,
  detail,
  running,
  onClose,
  onResume,
}: {
  wid: string;
  detail: BulkDetail;
  /** true while this page is sending the batch */
  running: boolean;
  onClose: () => void;
  onResume: () => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const counts = useMemo(() => {
    const c = { sent: 0, failed: 0, open: 0 };
    for (const r of detail.recipients) {
      if (r.status === "sent") c.sent++;
      else if (r.status === "failed") c.failed++;
      else c.open++;
    }
    return c;
  }, [detail.recipients]);
  const rows = detail.recipients
    .map((r, i) => ({ ...r, n: i + 1 }))
    .filter((r) => filter === "all" || (filter === "open" ? r.status === "pending" || r.status === "processing" : r.status === filter));

  const tabs: { key: Filter; label: string; count: number }[] = [
    { key: "all", label: "전체", count: detail.recipients.length },
    { key: "sent", label: "전송 완료", count: counts.sent },
    { key: "failed", label: "실패", count: counts.failed },
    { key: "open", label: "대기", count: counts.open },
  ];

  return (
    <Modal
      open
      onClose={onClose}
      width={760}
      title="대량전송 상세"
      icon={<ListChecks />}
      footerBar
      footerAlign="between"
      footer={
        <>
          <span className="text-xs text-fg-muted">대량전송을 삭제해도 이미 보낸 문서는 문서함에 남습니다.</span>
          <div className="flex gap-2">
            {detail.status === "sending" && detail.canManage && counts.open > 0 && (
              <Button variant="neutral" icon={<Play className="size-4" />} onClick={onResume} disabled={running}>
                {running ? "전송 중…" : "이어서 전송"}
              </Button>
            )}
            <Button variant="primary" onClick={onClose}>
              확인
            </Button>
          </div>
        </>
      }
    >
      <div className="px-[30px] pb-6 pt-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="truncate text-lg font-bold text-fg">{detail.title}</p>
            <p className="mt-1 text-[13px] text-fg-muted">
              템플릿 {detail.templateTitle ?? "(삭제되었거나 볼 수 없는 템플릿)"} · 생성자 {detail.ownerName ?? "-"}
            </p>
            <p className="mt-0.5 text-[13px] text-fg-muted">
              생성 {fmtDateTime(detail.createdAt)} · 전송 {fmtDateTime(detail.sentAt)}
            </p>
          </div>
          <StatusBadge tone={BULK_TONE[detail.status]}>{BULK_STATUS_LABEL[detail.status]}</StatusBadge>
        </div>

        <div className="mt-5 flex gap-1.5" role="tablist" aria-label="결과 필터">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={filter === t.key}
              onClick={() => setFilter(t.key)}
              className={cn(
                "h-7 rounded-full border px-2.5 text-[13px] font-medium transition-colors",
                filter === t.key ? "border-fg-3 bg-line-light text-white" : "border-line-light bg-surface-3 text-fg-muted hover:text-fg-2",
              )}
            >
              {t.label} {t.count}
            </button>
          ))}
        </div>

        <div className="mt-3 overflow-hidden rounded-md border border-line" role="table" aria-label="수신자별 결과">
          <div className="flex h-9 items-center border-b border-line bg-surface-3 px-3 text-xs text-fg-faint" role="row">
            <span className="w-10 shrink-0" role="columnheader">
              #
            </span>
            <span className="w-[150px] shrink-0 px-1" role="columnheader">
              이름
            </span>
            <span className="min-w-0 flex-1 px-1" role="columnheader">
              이메일
            </span>
            <span className="w-[190px] shrink-0 px-1" role="columnheader">
              결과
            </span>
            <span className="w-[76px] shrink-0 text-right" role="columnheader">
              문서
            </span>
          </div>
          <div className="max-h-[360px] overflow-y-auto">
            {rows.length === 0 ? (
              <p className="px-4 py-10 text-center text-[13px] text-fg-muted">해당하는 수신자가 없습니다.</p>
            ) : (
              rows.map((r) => (
                <div key={r.n} className="flex min-h-11 items-center border-b border-line-light px-3 py-1.5 text-[13px] last:border-b-0" role="row">
                  <span className="w-10 shrink-0 text-xs text-fg-muted" role="cell">
                    {r.n}
                  </span>
                  <span className="w-[150px] shrink-0 truncate px-1 font-medium text-fg" role="cell">
                    {r.name}
                  </span>
                  <span className="min-w-0 flex-1 truncate px-1 text-fg-2" role="cell">
                    {r.email}
                  </span>
                  <span className="w-[190px] shrink-0 px-1" role="cell">
                    <span className={cn("font-medium", RESULT[r.status].className)}>{RESULT[r.status].label}</span>
                    {r.status === "failed" && r.error && (
                      <span className="block truncate text-xs text-fg-muted" title={r.error}>
                        {r.error}
                      </span>
                    )}
                  </span>
                  <span className="w-[76px] shrink-0 text-right" role="cell">
                    {r.document_id ? (
                      <Link
                        href={`/workspaces/${wid}/documents/${r.document_id}`}
                        className="inline-flex items-center gap-0.5 text-xs font-medium text-emphasis hover:underline"
                      >
                        문서 보기
                        <ExternalLink className="size-3" />
                      </Link>
                    ) : (
                      <span className="text-xs text-fg-disabled">-</span>
                    )}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
