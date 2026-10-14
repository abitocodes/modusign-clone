"use client";

import { Ban, Check, ChevronLeft, CircleCheck, Download, Send, Trash2, X, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";

import { usePdfDocument } from "@/components/pdf/pdf";
import { ApprovalSeal, ApprovalStatusBadge } from "@/components/tools/approval-status";
import { Counter } from "@/components/tools/form-layout";
import { Spinner } from "@/components/tools/list-states";
import { PdfPages, useElementWidth } from "@/components/tools/pdf-pages";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { ConfirmModal, Modal } from "@/components/ui/modal";
import {
  APPROVAL_COMMENT_LIMIT,
  currentApprover,
  describeApprovalEvent,
  type ApprovalEventRow,
  type ApprovalEventType,
  type ApprovalListItem,
} from "@/lib/tools/approvals";
import { cn, fmtDashDateTime, fmtDate } from "@/lib/utils";

import { cancelApproval, decideApproval, deleteApproval, getApprovalDownloadUrl } from "../actions";

const EVENT_ICON: Record<ApprovalEventType, LucideIcon> = {
  submitted: Send,
  approved: Check,
  rejected: X,
  cancelled: Ban,
  completed: CircleCheck,
};

const EVENT_TONE: Record<ApprovalEventType, string> = {
  submitted: "border-emphasis-border bg-emphasis-bg text-emphasis",
  approved: "border-positive-border bg-positive-bg text-positive",
  rejected: "border-negative-border bg-negative-bg text-negative",
  cancelled: "border-neutral-badge-border bg-neutral-badge-bg text-neutral-badge-text",
  completed: "border-positive-border bg-positive-bg text-positive",
};

const EVENT_ORDER: Record<ApprovalEventType, number> = { submitted: 0, approved: 1, rejected: 1, cancelled: 1, completed: 2 };

/** 내부결재 상세 — PDF viewer + 결재란 / 기안 정보 / 진행 이력 panel. */
export function ApprovalDetailView({
  wid,
  userId,
  approval,
  events,
  pdfUrl,
}: {
  wid: string;
  userId: string;
  approval: ApprovalListItem;
  events: ApprovalEventRow[];
  pdfUrl: string | null;
}) {
  const router = useRouter();
  const listHref = `/workspaces/${wid}/esign/requests/approvals`;
  // keep the first signed URL so a refresh after an action does not reload the PDF
  const [src] = useState(pdfUrl);
  const pdf = usePdfDocument(src);
  const [viewerRef, viewerWidth] = useElementWidth<HTMLDivElement>();
  const pageWidth = Math.max(280, Math.min(816, viewerWidth));

  const [decision, setDecision] = useState<"approve" | "reject" | null>(null);
  const [comment, setComment] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const isDrafter = approval.drafter_id === userId;
  const inProgress = approval.status === "in_progress" || approval.status === "pending";
  const current = currentApprover(approval);
  const myTurn = !!current && current.approver.user_id === userId;
  const nextApprover = current ? approval.approvers[current.index + 1] : undefined;
  const deletable = isDrafter && (approval.status === "rejected" || approval.status === "cancelled");
  const rejectedBy = approval.approvers.find((a) => a.status === "rejected");

  const sortedEvents = [...events].sort(
    (a, b) => a.created_at.localeCompare(b.created_at) || EVENT_ORDER[a.type] - EVENT_ORDER[b.type],
  );

  const openDecision = (d: "approve" | "reject") => {
    setComment("");
    setDecision(d);
  };

  const decide = () => {
    if (!decision || pending) return;
    const text = comment.trim();
    if (decision === "reject" && !text) return;
    startTransition(async () => {
      const res = await decideApproval(wid, approval.id, decision, text);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      if (decision === "reject") toast.success("반려했습니다. 기안자에게 알림을 보냈습니다.");
      else if (res.status === "approved") toast.success("최종 승인했습니다. 결재가 완료되었습니다.");
      else toast.success("승인했습니다. 다음 결재자에게 결재를 요청했습니다.");
      setDecision(null);
      setComment("");
    });
  };

  const download = () =>
    startTransition(async () => {
      const res = await getApprovalDownloadUrl(wid, approval.id);
      if (!res.ok) toast.error(res.error);
      else window.location.assign(res.url);
    });

  const runCancel = () =>
    startTransition(async () => {
      const res = await cancelApproval(wid, approval.id);
      if (!res.ok) toast.error(res.error);
      else toast.success("기안을 취소했습니다.");
    });

  const runDelete = () =>
    startTransition(async () => {
      const res = await deleteApproval(wid, approval.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("기안을 삭제했습니다.");
      router.replace(listHref);
    });

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-body">
      <header className="flex h-16 shrink-0 items-center gap-4 border-b border-line bg-surface px-6">
        <Link
          href={listHref}
          className="flex h-[42px] shrink-0 items-center gap-1.5 rounded-md bg-btn-light px-4 text-base font-medium text-fg-2 shadow-button hover:bg-btn-base"
        >
          <ChevronLeft className="size-4" />
          목록
        </Link>
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <ApprovalStatusBadge approval={approval} userId={userId} className="shrink-0" />
          <h1 className="truncate text-lg font-bold text-fg" title={approval.title}>
            {approval.title}
          </h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="lg" className="h-[42px]" icon={<Download className="size-4" />} disabled={!approval.file_path} onClick={download}>
            다운로드
          </Button>
          {deletable && (
            <Button variant="ghost" size="lg" className="h-[42px]" icon={<Trash2 className="size-4" />} disabled={pending} onClick={() => setDeleteOpen(true)}>
              삭제
            </Button>
          )}
          {isDrafter && inProgress && (
            <Button variant="light" size="lg" className="h-[42px]" icon={<Ban className="size-4" />} disabled={pending} onClick={() => setCancelOpen(true)}>
              기안 취소
            </Button>
          )}
          {myTurn && (
            <>
              <Button variant="danger" size="lg" className="h-[42px]" icon={<X className="size-4" />} disabled={pending} onClick={() => openDecision("reject")}>
                반려
              </Button>
              <Button variant="primary" size="lg" className="h-[42px] min-w-[104px]" icon={<Check className="size-4" />} disabled={pending} onClick={() => openDecision("approve")}>
                승인
              </Button>
            </>
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <section className="min-w-0 flex-1 overflow-y-auto bg-body-2 px-8 py-8" aria-label="기안 문서">
          <div ref={viewerRef} className="mx-auto w-full max-w-[816px]">
            {!src ? (
              <p className="py-24 text-center text-sm text-fg-muted">문서 파일을 찾을 수 없습니다.</p>
            ) : pdf.error ? (
              <p className="py-24 text-center text-sm text-negative">문서를 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.</p>
            ) : !pdf.doc ? (
              <div className="flex justify-center py-24">
                <Spinner />
              </div>
            ) : (
              <PdfPages doc={pdf.doc} pageSizes={pdf.pageSizes} width={pageWidth} />
            )}
          </div>
        </section>

        <aside className="w-[400px] shrink-0 overflow-y-auto border-l border-line bg-surface">
          <StatusNotice
            approval={approval}
            myTurn={myTurn}
            waitingName={current?.approver.name}
            rejectedBy={rejectedBy?.name}
            rejectReason={rejectedBy?.comment ?? null}
          />

          <PanelSection title="결재란">
            <ApprovalTable approval={approval} />
          </PanelSection>

          <PanelSection title="기안 정보">
            <dl className="space-y-2.5 text-[13px]">
              <InfoRow label="기안자">
                {approval.drafter?.name ?? "-"}
                {approval.drafter?.email && <span className="ml-1 text-fg-muted">({approval.drafter.email})</span>}
              </InfoRow>
              <InfoRow label="기안 일시">{fmtDashDateTime(approval.created_at)}</InfoRow>
              <InfoRow label="문서">
                <span className="break-all">{approval.file_name ?? "-"}</span>
                <span className="ml-1 text-fg-muted">· {approval.page_count}페이지</span>
              </InfoRow>
              {approval.completed_at && (
                <InfoRow label={approval.status === "approved" ? "완료 일시" : approval.status === "rejected" ? "반려 일시" : "취소 일시"}>
                  {fmtDashDateTime(approval.completed_at)}
                </InfoRow>
              )}
            </dl>
          </PanelSection>

          {approval.message && (
            <PanelSection title="기안 의견">
              <p className="whitespace-pre-wrap break-words rounded-md bg-surface-3 px-3 py-2.5 text-[13px] leading-relaxed text-fg-2">{approval.message}</p>
            </PanelSection>
          )}

          <PanelSection title="진행 이력" last>
            {sortedEvents.length === 0 ? (
              <p className="text-[13px] text-fg-muted">진행 이력이 없습니다.</p>
            ) : (
              <ol>
                {sortedEvents.map((e, i) => {
                  const Icon = EVENT_ICON[e.type] ?? Send;
                  return (
                    <li key={e.id} className="relative flex gap-3 pb-5 last:pb-0">
                      {i < sortedEvents.length - 1 && <span aria-hidden className="absolute bottom-0 left-[13px] top-7 w-px bg-line" />}
                      <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-full border", EVENT_TONE[e.type])}>
                        <Icon className="size-3.5" strokeWidth={2.6} />
                      </span>
                      <div className="min-w-0 flex-1 pt-1">
                        <p className="text-[13px] text-fg">{describeApprovalEvent(e)}</p>
                        {e.actor_email && <p className="text-xs text-fg-muted">{e.actor_email}</p>}
                        {e.comment && e.type !== "submitted" && (
                          <p className="mt-1.5 whitespace-pre-wrap break-words rounded bg-surface-3 px-3 py-2 text-[13px] text-fg-2">
                            <span className="mr-1.5 text-xs text-fg-muted">{e.type === "rejected" ? "반려 사유" : "의견"}</span>
                            {e.comment}
                          </p>
                        )}
                        <p className="mt-1 text-[11px] tabular-nums text-fg-faint">{fmtDashDateTime(e.created_at)}</p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </PanelSection>
        </aside>
      </div>

      <Modal
        open={!!decision}
        onClose={() => !pending && setDecision(null)}
        width={480}
        icon={decision === "reject" ? <X /> : <Check />}
        title={decision === "reject" ? "반려" : "승인"}
        footer={
          <>
            <Button variant="light" className="min-w-[60px] font-bold" disabled={pending} onClick={() => setDecision(null)}>
              취소
            </Button>
            <Button
              variant={decision === "reject" ? "danger" : "primary"}
              className="min-w-[60px] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={pending || (decision === "reject" && !comment.trim())}
              onClick={decide}
            >
              {pending ? "처리 중…" : decision === "reject" ? "반려" : "승인"}
            </Button>
          </>
        }
      >
        <div className="px-[30px] pb-2 pt-6">
          <p className="text-sm leading-relaxed text-fg-2">
            <b className="font-bold text-fg">{approval.title}</b> 기안을 {decision === "reject" ? "반려합니다." : "승인합니다."}
          </p>
          <p className="mt-1 text-[13px] text-fg-muted">
            {decision === "reject"
              ? "반려하면 결재가 종료되고 기안자에게 반려 사유가 전달됩니다."
              : nextApprover
                ? `승인하면 다음 결재자 ${nextApprover.name}님에게 결재 요청이 전송됩니다.`
                : "마지막 결재자입니다. 승인하면 결재가 완료됩니다."}
          </p>
          <label htmlFor="decision-comment" className="mt-5 block text-sm font-medium text-fg">
            {decision === "reject" ? (
              <>
                반려 사유<span className="text-negative">*</span>
              </>
            ) : (
              <>
                의견 <span className="text-xs font-normal text-fg-muted">(선택)</span>
              </>
            )}
          </label>
          <Textarea
            id="decision-comment"
            autoFocus
            className="mt-2 h-[110px]"
            value={comment}
            maxLength={APPROVAL_COMMENT_LIMIT}
            placeholder={decision === "reject" ? "반려 사유를 입력해 주세요" : "결재 의견을 남길 수 있습니다"}
            onChange={(e) => setComment(e.target.value)}
          />
          <Counter value={comment.length} max={APPROVAL_COMMENT_LIMIT} />
        </div>
      </Modal>

      <ConfirmModal
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        onConfirm={runCancel}
        title="기안을 취소할까요?"
        description="취소하면 결재가 중단되며, 결재 대기 중인 결재자에게 취소 알림이 전송됩니다."
        confirmLabel="기안 취소"
        cancelLabel="닫기"
        danger
      />
      <ConfirmModal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={runDelete}
        title="기안을 삭제할까요?"
        description="삭제한 기안 문서와 진행 이력은 되돌릴 수 없습니다."
        confirmLabel="삭제"
        danger
      />
    </div>
  );
}

function PanelSection({ title, children, last }: { title: string; children: ReactNode; last?: boolean }) {
  return (
    <section className={cn("px-6 py-5", !last && "border-b border-line-light")}>
      <h2 className="mb-3 text-sm font-bold text-fg">{title}</h2>
      {children}
    </section>
  );
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="w-[68px] shrink-0 text-fg-muted">{label}</dt>
      <dd className="min-w-0 flex-1 text-fg-2">{children}</dd>
    </div>
  );
}

function StatusNotice({
  approval,
  myTurn,
  waitingName,
  rejectedBy,
  rejectReason,
}: {
  approval: ApprovalListItem;
  myTurn: boolean;
  waitingName?: string;
  rejectedBy?: string;
  rejectReason: string | null;
}) {
  let tone = "border-emphasis-border bg-emphasis-bg";
  let text: ReactNode = null;
  if (approval.status === "approved") {
    tone = "border-positive-border bg-positive-bg";
    text = "모든 결재자가 승인하여 결재가 완료되었습니다.";
  } else if (approval.status === "rejected") {
    tone = "border-negative-border bg-negative-bg";
    text = (
      <>
        {rejectedBy ?? "결재자"}님이 반려했습니다.
        {rejectReason && <span className="mt-1 block whitespace-pre-wrap break-words text-fg-2">사유: {rejectReason}</span>}
      </>
    );
  } else if (approval.status === "cancelled") {
    tone = "border-neutral-badge-border bg-neutral-badge-bg";
    text = "기안자가 취소한 결재입니다.";
  } else if (myTurn) {
    tone = "border-warning-border bg-warning-bg";
    text = "결재할 차례입니다. 문서를 확인한 뒤 승인 또는 반려해 주세요.";
  } else if (waitingName) {
    text = `${waitingName}님의 결재를 기다리고 있습니다.`;
  }
  if (!text) return null;
  return (
    <div className="px-6 pt-5">
      <div role="status" className={cn("rounded-md border px-3.5 py-3 text-[13px] leading-relaxed text-fg", tone)}>
        {text}
      </div>
    </div>
  );
}

/** 결재란: 기안 box + one box per approver with seal-like marks and dates. */
function ApprovalTable({ approval }: { approval: ApprovalListItem }) {
  const n = approval.approvers.length;
  const closed = approval.status === "rejected" || approval.status === "cancelled";
  const boxes = [
    {
      key: "drafter",
      head: "기안",
      name: approval.drafter?.name ?? "기안자",
      state: "drafted" as const,
      at: approval.created_at as string | null,
    },
    ...approval.approvers.map((a, i) => ({
      key: `${a.user_id}-${i}`,
      head: n === 1 ? "결재" : i === n - 1 ? "최종 결재" : `결재 ${i + 1}`,
      name: a.name,
      state: a.status ?? "waiting",
      at: a.acted_at ?? null,
    })),
  ];
  // one row of up to 4 boxes; longer lines wrap and the last row is padded with blank cells
  const cols = Math.min(4, boxes.length);
  const fillers = (cols - (boxes.length % cols)) % cols;

  return (
    <div
      className="grid w-fit max-w-full gap-px overflow-hidden rounded-md border border-line bg-line"
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 86px))` }}
      role="list"
      aria-label="결재란"
    >
      {boxes.map((b) => (
        <div key={b.key} role="listitem" className={cn("flex flex-col bg-surface text-center", b.state === "pending" && "bg-warning-bg")}>
          <div className="flex h-7 items-center justify-center border-b border-line bg-surface-3 px-1 text-[11px] font-medium text-fg-muted">
            {b.head}
          </div>
          <div className="flex h-[76px] items-center justify-center">
            {b.state === "drafted" || b.state === "approved" || b.state === "rejected" ? (
              <ApprovalSeal kind={b.state} name={b.name} />
            ) : b.state === "pending" ? (
              <span className="text-xs font-bold text-warning">결재 중</span>
            ) : (
              <span className="text-xs text-fg-disabled">{closed ? "-" : "대기"}</span>
            )}
          </div>
          <div className="border-t border-line px-1 py-1.5">
            <p className="truncate text-xs font-medium text-fg-2" title={b.name}>
              {b.name}
            </p>
            <p className="truncate text-[11px] tabular-nums text-fg-faint" title={b.at ? fmtDashDateTime(b.at) : undefined}>
              {b.at ? fmtDate(b.at) : " "}
            </p>
          </div>
        </div>
      ))}
      {Array.from({ length: fillers }, (_, i) => (
        <div key={`filler-${i}`} aria-hidden className="bg-surface-2" />
      ))}
    </div>
  );
}
