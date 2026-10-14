"use client";

import { Check, ChevronLeft, ChevronRight, Cloud, Database, MessagesSquare, Webhook, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import type { DocStatus, RequestType } from "@/lib/types";
import { cn, fmtDateTime } from "@/lib/utils";

import { startInPersonSigning } from "../../../esign/documents/actions";

export interface CompletedDoc {
  id: string;
  title: string;
  status: DocStatus;
  request_type: RequestType;
  scheduled_at: string | null;
  /** pending 직접 대면 signers (requester / admin only) */
  inPersonPending: { id: string; name: string }[];
}

const INTEGRATIONS: { icon: LucideIcon; text: string }[] = [
  { icon: Database, text: "요청한 문서 데이터를 업무용 데이터베이스에 연결해 관리해보세요." },
  { icon: Cloud, text: "서명 완료 문서를 클라우드 드라이브에 자동으로 보관해보세요." },
  { icon: MessagesSquare, text: "서명 진행 알림을 사내 메신저로 받아보세요." },
  { icon: Webhook, text: "API와 웹훅으로 사내 시스템에서 바로 서명을 요청해보세요." },
];

export function CompletedClient({ wid, doc }: { wid: string; doc: CompletedDoc | null }) {
  const [slide, setSlide] = useState(0);
  const scheduled = doc?.status === "scheduled";
  const base = `/workspaces/${wid}`;
  const boxHref = `${base}/esign/documents/documents?status=${scheduled ? "scheduled" : "all"}`;
  const item = INTEGRATIONS[slide];
  const Icon = item.icon;
  const [inPersonBusy, startInPerson] = useTransition();
  const verb = doc?.request_type === "view" ? "열람" : "서명";

  return (
    <main className="min-h-screen bg-body-2 px-4 pb-20 pt-3">
      <div className="mx-auto w-full max-w-[654px]">
        <section className="flex min-h-[266px] flex-col items-center justify-center rounded-xl border border-line bg-surface px-8 pb-[30px] pt-10 text-center">
          <span className="flex size-[46px] items-center justify-center rounded-full bg-p1" aria-hidden>
            <Check className="size-6 text-fg-reversed" strokeWidth={3.2} />
          </span>
          <h1 className="mt-5 text-[22px] font-bold text-fg">{scheduled ? "예약 완료" : "전송 완료"}</h1>
          <p className="mt-2.5 max-w-full text-[13px] text-fg-2" title={doc?.title}>
            {scheduled && doc?.scheduled_at
              ? `문서가 ${fmtDateTime(doc.scheduled_at)}에 전송될 예정입니다.`
              : "문서가 전송되었습니다."}
          </p>
          <Link
            href={boxHref}
            className="mt-6 inline-flex h-10 items-center gap-1 rounded-md bg-primary px-[22px] text-sm font-semibold text-primary-fg shadow-button hover:bg-primary-hover"
          >
            문서함으로
            <ChevronRight className="size-4" />
          </Link>
          {doc && doc.inPersonPending.length > 0 && (
            <div className="mt-4 flex flex-col items-center gap-2">
              <p className="text-[13px] text-fg-muted">직접 대면 {verb}자의 차례입니다. 이 기기를 {verb}자에게 건네주세요.</p>
              {doc.inPersonPending.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  disabled={inPersonBusy}
                  onClick={() =>
                    startInPerson(async () => {
                      const res = await startInPersonSigning(wid, doc.id, p.id);
                      if (res && !res.ok) toast.error(res.error);
                    })
                  }
                  className="inline-flex h-10 items-center gap-1 rounded-md bg-btn-dark px-[22px] text-sm font-semibold text-fg-2 hover:bg-btn-hover disabled:opacity-60"
                >
                  지금 직접 대면 {verb} 시작 ({p.name})
                  <ChevronRight className="size-4" />
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="mt-3.5 flex min-h-[112px] items-center justify-between gap-6 rounded-xl border border-line bg-surface p-[30px]">
          <div className="min-w-0">
            <p className="text-[15px] font-bold text-fg">후속 문서도 이어서 보내보세요!</p>
            <p className="mt-2 text-[13px] text-fg-2">방금 보낸 문서의 설정값이 유지된 후속 문서를 전송해 보세요.</p>
          </div>
          <button
            type="button"
            onClick={() => toast("후속 문서 전송은 준비 중입니다.")}
            className="h-10 w-[78px] shrink-0 rounded-md bg-btn-dark text-sm font-semibold text-fg-2 hover:bg-btn-hover"
          >
            시작
          </button>
        </section>

        <section className="mt-9" aria-roledescription="carousel" aria-label="연동·API 통합 둘러보기">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-fg">연동·API 통합 둘러보기</h2>
            <div className="flex gap-1.5" role="tablist" aria-label="슬라이드 선택">
              {INTEGRATIONS.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  role="tab"
                  aria-selected={i === slide}
                  aria-label={`${i + 1}번째 슬라이드`}
                  onClick={() => setSlide(i)}
                  className={cn("size-1.5 rounded-full transition-colors", i === slide ? "bg-fg" : "bg-fg-disabled hover:bg-fg-muted")}
                />
              ))}
            </div>
          </div>
          <div className="relative mt-3">
            <button
              type="button"
              aria-label="이전 슬라이드"
              onClick={() => setSlide((s) => (s - 1 + INTEGRATIONS.length) % INTEGRATIONS.length)}
              className="absolute -left-7 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center text-fg-muted hover:text-fg"
            >
              <ChevronLeft className="size-5" />
            </button>
            <div className="flex min-h-[98px] items-center gap-6 rounded-xl border border-line bg-surface px-6 py-4" aria-live="polite">
              <span className="flex size-[62px] shrink-0 items-center justify-center rounded-lg border border-line bg-surface-3" aria-hidden>
                <Icon className="size-7 text-icon" strokeWidth={1.8} />
              </span>
              <p className="min-w-0 flex-1 text-base font-medium text-fg">{item.text}</p>
              <button
                type="button"
                onClick={() => toast("연동 기능은 준비 중입니다.")}
                className="h-10 w-[78px] shrink-0 rounded-md bg-btn-dark text-sm font-semibold text-fg-2 hover:bg-btn-hover"
              >
                연결
              </button>
            </div>
            <button
              type="button"
              aria-label="다음 슬라이드"
              onClick={() => setSlide((s) => (s + 1) % INTEGRATIONS.length)}
              className="absolute -right-7 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center text-fg-muted hover:text-fg"
            >
              <ChevronRight className="size-5" />
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
