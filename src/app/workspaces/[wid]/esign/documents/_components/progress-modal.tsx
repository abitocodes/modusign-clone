"use client";

import { LoaderCircle, User } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import {
  displayParticipantStatus,
  docProgressLabel,
  fmtKoreanDateTime,
  participantStatusLabel,
  type ProgressEvent,
  type ProgressInfo,
} from "@/lib/documents/view";

import { getProgressInfo } from "../actions";

import { LocalTime } from "./local-time";

type LoadState = { docId: string; info: ProgressInfo | null; error: string | null };

/** 서명 진행 정보 modal (진행 정보 확인). Loads its data when `docId` is set. */
export function ProgressInfoModal({ wid, docId, onClose }: { wid: string; docId: string | null; onClose: () => void }) {
  const [state, setState] = useState<LoadState | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!docId) return;
    let cancelled = false;
    getProgressInfo(wid, docId)
      .then((res) => {
        if (cancelled) return;
        setState(res.ok ? { docId, info: res.info, error: null } : { docId, info: null, error: res.error });
      })
      .catch(() => {
        if (!cancelled) setState({ docId, info: null, error: "진행 정보를 불러오지 못했습니다." });
      });
    return () => {
      cancelled = true;
    };
  }, [wid, docId, attempt]);

  const current = state && state.docId === docId ? state : null;

  return (
    <Modal
      open={!!docId}
      onClose={onClose}
      width={912}
      title="서명 진행 정보"
      icon={<User fill="currentColor" />}
      bodyClassName="overflow-hidden"
    >
      <div className="flex h-[min(505px,calc(100vh-197px))]">
        {!current ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-sm text-fg-muted" role="status">
            <LoaderCircle className="size-5 animate-spin" />
            진행 정보를 불러오는 중입니다.
          </div>
        ) : current.error || !current.info ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-sm text-fg-muted" role="alert">
            {current.error ?? "진행 정보를 불러오지 못했습니다."}
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setState(null);
                setAttempt((n) => n + 1);
              }}
            >
              다시 시도
            </Button>
          </div>
        ) : (
          <ProgressColumns info={current.info} />
        )}
      </div>
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-line px-[30px] py-[30px] last:border-b-0">
      <h3 className="mb-5 text-base font-bold text-fg">{title}</h3>
      {children}
    </section>
  );
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 py-1.5 text-[13px]">
      <dt className="w-[117px] shrink-0 text-fg-muted">{label}</dt>
      <dd className="min-w-0 flex-1 break-all font-bold text-fg">{children}</dd>
    </div>
  );
}

function ProgressColumns({ info }: { info: ProgressInfo }) {
  const { doc, requester, participants, events } = info;
  const view = doc.request_type === "view";
  return (
    <>
      <div className="min-w-0 flex-1 overflow-y-auto">
        <Section title="문서">
          <dl>
            <InfoRow label="문서 제목">{doc.title}</InfoRow>
            <InfoRow label="문서 ID">{doc.id}</InfoRow>
            <InfoRow label={view ? "열람 진행 상태" : "서명 진행 상태"}>{docProgressLabel(doc.status, doc.request_type)}</InfoRow>
            <InfoRow label="기준 시간">사용자 컴퓨터 시간 기준</InfoRow>
          </dl>
        </Section>
        <Section title="요청자">
          {requester ? (
            <>
              <p className="mb-2 text-[13px] font-bold text-fg">
                {requester.name} ({requester.email})
              </p>
              <dl>
                <InfoRow label="인증 상태">사내 계정 인증 완료</InfoRow>
              </dl>
            </>
          ) : (
            <p className="text-[13px] text-fg-muted">요청자 정보를 확인할 수 없습니다.</p>
          )}
        </Section>
        <Section title={view ? "열람자" : "서명자"}>
          {participants.length === 0 && <p className="text-[13px] text-fg-muted">참여자가 없습니다.</p>}
          <div className="space-y-5">
            {participants.map((p) => {
              const status = displayParticipantStatus(p.status, doc.status);
              const done = status === "signed" || (view && status === "viewed");
              return (
                <div key={p.id}>
                  <p className="mb-2 text-[13px] font-bold text-fg">
                    {p.name || "이름 없음"}
                    {p.email ? ` (${p.email})` : ""}
                  </p>
                  <dl>
                    <InfoRow label="진행 상태">{participantStatusLabel(status, doc.request_type)}</InfoRow>
                    {done && (p.signed_at || p.viewed_at) && (
                      <InfoRow label={view ? "열람 일시" : "서명 일시"}>{fmtKoreanDateTime((p.signed_at ?? p.viewed_at)!)}</InfoRow>
                    )}
                    {status === "rejected" && p.reject_reason && <InfoRow label="거절 사유">{p.reject_reason}</InfoRow>}
                    {(status === "pending" || status === "viewed") && !done && p.expires_at && (
                      <InfoRow label={view ? "열람 기한" : "서명 기한"}>{fmtKoreanDateTime(p.expires_at)} 까지</InfoRow>
                    )}
                  </dl>
                </div>
              );
            })}
          </div>
        </Section>
      </div>
      <div className="w-[397px] shrink-0 overflow-y-auto border-l border-line px-[30px] py-[30px]">
        <h3 className="mb-5 text-base font-bold text-fg">진행 이력</h3>
        <EventList events={events} />
      </div>
    </>
  );
}

/** 진행 이력 list (also used by the document viewer's side panel). */
export function EventList({ events, compact }: { events: ProgressEvent[]; compact?: boolean }) {
  if (!events.length) return <p className="border-t border-line pt-4 text-[13px] text-fg-muted">아직 진행 이력이 없습니다.</p>;
  return (
    <ol>
      {events.map((e) => (
        <li key={e.id} className={compact ? "border-t border-line py-3" : "border-t border-line px-1.5 py-4"}>
          <p className="break-all text-[13px] leading-relaxed text-fg">{e.text}</p>
          <p className="mt-1.5 text-xs text-fg-muted">
            <LocalTime iso={e.created_at} variant="seconds" /> /{e.auto ? "자동 진행" : (e.ip ?? "-")}
          </p>
        </li>
      ))}
    </ol>
  );
}
