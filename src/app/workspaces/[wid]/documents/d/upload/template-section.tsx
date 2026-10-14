"use client";

import { ChevronDown, ChevronRight, FileText, Info } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";

import { PdfPageView, usePdfDocument } from "@/components/pdf/pdf";
import { Chip } from "@/components/ui/badge";
import type { RequestType } from "@/lib/types";
import { cn, participantColor } from "@/lib/utils";

export interface TemplateCardData {
  id: string;
  title: string;
  requestType: RequestType;
  pageCount: number;
  /** signed URL of the template PDF (null → generic page icon) */
  thumbUrl: string | null;
}

const VISIBLE = 5;
const THUMB_W = 166;

function GenericPage() {
  return (
    <div className="flex size-full items-center justify-center bg-page">
      <FileText className="size-12 text-fg-disabled" strokeWidth={1.4} />
    </div>
  );
}

function TemplateThumb({ url }: { url: string | null }) {
  const { doc, error, loading } = usePdfDocument(url);
  if (!url || error) return <GenericPage />;
  if (loading || !doc) return <div className="size-full animate-pulse bg-page" />;
  return <PdfPageView doc={doc} pageNumber={1} width={THUMB_W} className="shadow-none" />;
}

function CardShell({ href, thumb, chip, title, hint }: { href: string; thumb: ReactNode; chip: ReactNode; title: string; hint?: string }) {
  return (
    <Link href={href} className="group block w-[168px] shrink-0 rounded focus-visible:outline-2 focus-visible:outline-emphasis" title={hint ?? title}>
      <div className="h-[237px] overflow-hidden rounded border border-line-strong bg-page transition-[border-color,transform] group-hover:-translate-y-0.5 group-hover:border-fg-muted">
        {thumb}
      </div>
      <div className="mt-3">{chip}</div>
      <p className="mt-1.5 truncate text-[15px] text-fg">{title}</p>
    </Link>
  );
}

/* ---------------------------------------------------------------- samples */

function Lines({ y, count, width = 118, gap = 9 }: { y: number; count: number; width?: number; gap?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <rect key={i} x="24" y={y + i * gap} width={i === count - 1 ? width * 0.6 : width} height="3" rx="1.5" fill="#d9d9d9" />
      ))}
    </>
  );
}

function SampleArt({ variant }: { variant: 0 | 1 | 2 }) {
  const c1 = participantColor(0);
  const c2 = participantColor(1);
  return (
    <svg viewBox="0 0 166 235" className="size-full" aria-hidden>
      <rect width="166" height="235" fill="#ffffff" />
      <rect x="24" y="24" width="72" height="7" rx="2" fill="#474747" />
      <Lines y={44} count={4} />
      {variant === 0 && (
        <>
          <Lines y={92} count={3} />
          <rect x="96" y="160" width="46" height="46" rx="3" fill={c1} fillOpacity="0.25" stroke={c1} />
          <circle cx="119" cy="183" r="8" fill="none" stroke={c1} strokeWidth="2" />
          <circle cx="119" cy="183" r="3" fill={c1} />
          <rect x="24" y="180" width="56" height="3" rx="1.5" fill="#d9d9d9" />
          <rect x="24" y="192" width="40" height="3" rx="1.5" fill="#d9d9d9" />
        </>
      )}
      {variant === 1 && (
        <>
          <rect x="24" y="96" width="118" height="54" rx="3" fill="#f4f4f4" stroke="#d1d1d1" strokeDasharray="4 3" />
          <circle cx="83" cy="123" r="13" fill="#5991f4" />
          <path d="M83 116v14M76 123h14" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" />
          <Lines y={166} count={3} />
        </>
      )}
      {variant === 2 && (
        <>
          <Lines y={92} count={3} />
          <rect x="24" y="150" width="54" height="22" rx="2" fill={c1} fillOpacity="0.25" stroke={c1} />
          <rect x="88" y="150" width="54" height="22" rx="2" fill={c2} fillOpacity="0.25" stroke={c2} />
          <rect x="24" y="182" width="54" height="22" rx="2" fill={c1} fillOpacity="0.25" stroke={c1} />
          <rect x="88" y="182" width="54" height="22" rx="2" fill={c2} fillOpacity="0.25" stroke={c2} />
          <path d="M118 112l22-10-8 24-5-9z" fill="#856d00" />
        </>
      )}
    </svg>
  );
}

const SAMPLES: { title: string; hint: string }[] = [
  { title: "템플릿이란?", hint: "자주 쓰는 문서와 서명 입력란 위치를 저장해 두고 반복해서 서명을 요청할 수 있어요." },
  { title: "템플릿 등록하기", hint: "서명 요청 > 템플릿에서 문서를 등록하고 참여자 역할과 입력란을 배치하세요." },
  { title: "템플릿으로 서명 요청", hint: "등록한 템플릿을 고르고 참여자 정보만 입력하면 바로 서명 요청을 보낼 수 있어요." },
];

/* ---------------------------------------------------------------- section */

export function TemplateSection({ wid, templates }: { wid: string; templates: TemplateCardData[] }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? templates : templates.slice(0, VISIBLE);
  const listHref = `/workspaces/${wid}/esign/requests/templates`;

  return (
    <section className="bg-surface-2 pb-[72px] pt-[52px]" aria-labelledby="template-start-title">
      <div className="mx-auto w-full max-w-[968px] px-4">
        <h2 id="template-start-title" className="flex items-center gap-2 text-[32px] font-bold leading-tight text-fg">
          준비된 템플릿으로 시작
          <span title="템플릿은 서명 요청 > 템플릿 메뉴에서 등록하고 관리할 수 있습니다." className="inline-flex">
            <Info className="size-5 text-fg-3" strokeWidth={1.8} aria-label="템플릿 안내" />
          </span>
        </h2>
        <p className="mt-2 text-base font-medium text-fg-2">계약서, 통지서 등 다양한 문서 템플릿들이 준비되어 있습니다.</p>

        {templates.length > 0 ? (
          <>
            <p className="mt-10 text-base font-medium text-fg">워크스페이스 템플릿</p>
            <div className="mt-4 flex flex-wrap gap-5">
              {shown.map((t) => (
                <CardShell
                  key={t.id}
                  href={`/workspaces/${wid}/templates/${t.id}/use`}
                  title={t.title}
                  hint={`'${t.title}' 템플릿으로 서명 요청 시작`}
                  thumb={<TemplateThumb url={t.thumbUrl} />}
                  chip={t.requestType === "view" ? <Chip tone="emphasis">열람</Chip> : <Chip>서명</Chip>}
                />
              ))}
            </div>
            {templates.length > VISIBLE && (
              <div className="mt-8 flex justify-center">
                <button
                  type="button"
                  onClick={() => setExpanded((v) => !v)}
                  aria-label={expanded ? "템플릿 접기" : "템플릿 더 보기"}
                  aria-expanded={expanded}
                  className="flex size-10 items-center justify-center rounded-full border border-line-strong bg-btn-light text-icon-2 hover:bg-btn-base"
                >
                  <ChevronDown className={cn("size-5 transition-transform", expanded && "rotate-180")} />
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            <p className="mt-10 text-base font-medium text-fg">추천</p>
            <div className="mt-4 flex flex-wrap gap-5">
              {SAMPLES.map((s, i) => (
                <CardShell
                  key={s.title}
                  href={listHref}
                  title={s.title}
                  hint={s.hint}
                  thumb={<SampleArt variant={i as 0 | 1 | 2} />}
                  chip={<Chip tone="emphasis">안내</Chip>}
                />
              ))}
              <div className="flex w-[300px] flex-col justify-center rounded border border-line-light bg-surface p-6">
                <p className="text-[15px] font-bold text-fg">아직 등록된 템플릿이 없습니다.</p>
                <p className="mt-2 text-[13px] leading-relaxed text-fg-muted">
                  자주 쓰는 문서를 템플릿으로 등록하면 참여자 역할과 입력란 위치가 저장되어, 다음부터는 업로드 없이 바로 서명을 요청할 수 있어요.
                </p>
                <Link href={listHref} className="mt-4 inline-flex items-center gap-0.5 text-[13px] font-semibold text-emphasis hover:underline">
                  템플릿 관리로 이동
                  <ChevronRight className="size-3.5" />
                </Link>
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
