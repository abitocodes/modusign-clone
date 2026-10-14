"use client";

import { Ban, CircleX, Clock, FileQuestion, FileText, Hourglass, PencilLine } from "lucide-react";
import { useState, type ReactNode } from "react";

import { fmtSeoulDateTime } from "../_lib/format";
import { signDownloadHref, type MessageKind, type SignDone } from "../_lib/types";
import { Card, CardPage } from "./chrome";
import { ReadOnlyViewer } from "./document-viewer";
import { SecuredDocumentIllustration, StatusIcon } from "./illustrations";

const MESSAGES: Record<
  MessageKind,
  { icon: ReactNode; tone: "neutral" | "negative" | "warning"; title: (verb: string) => string; lines: (verb: string) => string[] }
> = {
  invalid: {
    icon: <FileQuestion />,
    tone: "neutral",
    title: () => "유효하지 않은 링크입니다.",
    lines: () => ["링크가 올바르지 않거나 더 이상 사용할 수 없습니다.", "메일에 포함된 링크를 다시 확인해 주세요."],
  },
  unavailable: {
    icon: <FileQuestion />,
    tone: "neutral",
    title: () => "문서를 불러올 수 없습니다.",
    lines: () => ["문서 파일을 준비하지 못했습니다.", "잠시 후 다시 시도해 주세요."],
  },
  not_sent: {
    icon: <FileText />,
    tone: "neutral",
    title: () => "아직 전송되지 않은 문서입니다.",
    lines: (v) => [`요청자가 ${v} 요청을 전송하면`, "이메일로 안내해 드립니다."],
  },
  modifying: {
    icon: <PencilLine />,
    tone: "neutral",
    title: () => "문서를 수정하고 있습니다.",
    lines: () => ["요청자가 문서 내용을 수정하고 있습니다.", "수정이 끝나면 이메일로 다시 안내해 드립니다."],
  },
  request_cancelled: {
    icon: <Ban />,
    tone: "negative",
    title: (v) => `${v} 요청이 취소된 문서입니다.`,
    lines: (v) => [`요청자가 ${v} 요청을 취소했습니다.`, "자세한 내용은 요청자에게 문의해 주세요."],
  },
  signing_cancelled: {
    icon: <Ban />,
    tone: "negative",
    title: (v) => `${v}이 취소된 문서입니다.`,
    lines: () => ["자세한 내용은 요청자에게 문의해 주세요."],
  },
  rejected: {
    icon: <CircleX />,
    tone: "negative",
    title: () => "서명이 거절된 문서입니다.",
    lines: () => ["참여자 중 한 명이 서명을 거절하여", "서명 절차가 종료되었습니다."],
  },
  rejected_by_me: {
    icon: <CircleX />,
    tone: "negative",
    title: () => "서명을 거절했습니다.",
    lines: () => ["요청자에게 거절 사유를 전달했습니다."],
  },
  expired: {
    icon: <Clock />,
    tone: "warning",
    title: (v) => `${v} 기한이 만료되었습니다.`,
    lines: (v) => [`${v} 기한이 지나 더 이상 ${v}할 수 없습니다.`, "필요하면 요청자에게 다시 요청해 주세요."],
  },
  waiting: {
    icon: <Hourglass />,
    tone: "neutral",
    title: (v) => `아직 ${v} 차례가 아닙니다.`,
    lines: (v) => [`앞 순서의 참여자가 ${v}을 마치면`, `이메일로 ${v} 차례를 알려 드립니다.`],
  },
};

/** One centred status card (invalid link, cancelled, rejected, expired, not my turn …). */
export function MessagePage({ message, view, reason }: { message: MessageKind; view: boolean; reason?: string | null }) {
  const m = MESSAGES[message];
  const verb = view ? "열람" : "서명";
  return (
    <CardPage>
      <Card className="max-w-[414px] px-6 py-14">
        <div className="flex flex-col items-center text-center" role="status">
          <StatusIcon tone={m.tone}>{m.icon}</StatusIcon>
          <h1 className="mt-5 text-xl font-bold text-fg">{m.title(verb)}</h1>
          <div className="mt-2 text-[13px] font-medium leading-relaxed text-fg-2">
            {m.lines(verb).map((l) => (
              <p key={l}>{l}</p>
            ))}
          </div>
          {reason && (
            <div className="mt-6 w-full max-w-[320px] rounded border border-line-strong bg-surface-3 px-4 py-3 text-left">
              <p className="text-xs font-bold text-fg-muted">거절 사유</p>
              <p className="mt-1 whitespace-pre-wrap break-words text-[13px] text-fg">{reason}</p>
            </div>
          )}
        </div>
      </Card>
    </CardPage>
  );
}

/** 내 서명 완료 / 모든 서명 완료 (+ 서명 내역 card instead of the original sign-up promotion). */
export function DonePage({ done }: { done: SignDone }) {
  const [preview, setPreview] = useState(false);
  const view = done.requestType === "view";
  const verb = view ? "열람" : "서명";

  if (preview && done.preview) {
    return <ReadOnlyViewer done={done} onClose={() => setPreview(false)} />;
  }

  return (
    <CardPage menu={done.menu}>
      <div className="flex w-full max-w-[658px] flex-col gap-3">
        <Card className="flex min-h-[177px] flex-col items-center justify-center rounded px-6 py-10 text-center">
          {done.completed ? (
            <>
              <h1 className="text-xl font-bold text-fg">모든 {verb} 완료</h1>
              <div className="mt-3 text-[13px] leading-relaxed text-fg-2">
                <p>{verb} 완료 문서와 진행 이력이 담긴 인증서가</p>
                <p>이메일로 전송되었습니다.</p>
              </div>
              <a
                href={signDownloadHref(done.token, "completed")}
                className="mt-6 inline-flex h-10 items-center rounded bg-primary px-[22px] text-sm font-bold text-primary-fg shadow-button hover:bg-primary-hover"
              >
                완료 문서 다운로드
              </a>
            </>
          ) : (
            <>
              <h1 className="text-xl font-bold text-fg">내 {verb} 완료</h1>
              <div className="mt-3 text-[13px] leading-relaxed text-fg-2">
                <p>{view ? "모든 열람자의 열람이 완료되면," : "모든 서명자의 서명이 완료되면,"}</p>
                <p>{verb} 완료 문서가 이메일로 전송됩니다.</p>
              </div>
            </>
          )}
        </Card>

        <Card className="flex flex-col items-center rounded px-6 pb-10 pt-12 text-center">
          <h2 className="text-xl font-bold text-fg">{verb} 내역</h2>
          <p className="mt-3 text-[13px] text-fg-2">{verb}한 문서는 안전하게 보관되며, 진행 이력은 감사 로그로 기록됩니다.</p>
          <dl className="mt-6 w-full max-w-[420px] divide-y divide-line-light overflow-hidden rounded border border-line-strong bg-surface-3 text-left text-[13px]">
            <div className="flex gap-3 px-4 py-3">
              <dt className="w-[72px] shrink-0 text-fg-muted">문서 제목</dt>
              <dd className="min-w-0 break-words font-bold text-fg">{done.title}</dd>
            </div>
            <div className="flex gap-3 px-4 py-3">
              <dt className="w-[72px] shrink-0 text-fg-muted">{verb} 일시</dt>
              <dd className="font-bold text-fg">{fmtSeoulDateTime(done.signedAt)}</dd>
            </div>
            <div className="flex gap-3 px-4 py-3">
              <dt className="w-[72px] shrink-0 text-fg-muted">문서 ID</dt>
              <dd className="min-w-0 break-all text-fg-2">{done.documentId}</dd>
            </div>
          </dl>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <button
              type="button"
              disabled={!done.preview}
              onClick={() => setPreview(true)}
              className="inline-flex h-10 items-center gap-1.5 rounded bg-btn-dark px-5 text-sm font-medium text-fg-2 hover:bg-btn-hover disabled:bg-btn-disabled disabled:text-fg-disabled"
            >
              <FileText className="size-4" />
              문서 미리보기
            </button>
            {done.completed && (
              <a
                href={signDownloadHref(done.token, "audit")}
                className="inline-flex h-10 items-center rounded border border-line-strong bg-btn-light px-5 text-sm font-medium text-fg-2 hover:bg-btn-base"
              >
                감사 추적 인증서
              </a>
            )}
          </div>
          <SecuredDocumentIllustration className="mt-8 h-[132px] w-[160px]" />
        </Card>
      </div>
    </CardPage>
  );
}
