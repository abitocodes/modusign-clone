"use client";

import { ArrowLeft, CircleAlert, CircleMinus, CirclePlus, Download, FileDown, FileX, LoaderCircle, PenLine } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";

import { FieldValue } from "@/components/fields/field-value";
import { PdfPageView, PdfThumbnail, usePdfDocument } from "@/components/pdf/pdf";
import { StatusBadge } from "@/components/ui/badge";
import {
  documentsHome,
  downloadHref,
  isMe,
  sortParticipants,
  type ProgressInfo,
} from "@/lib/documents/view";
import { FIELD_META } from "@/lib/fields";
import type { DocStatus, FieldRow, PageSize, RequestType, SigningOrder } from "@/lib/types";
import { cn, documentBadge, participantColor, withAlpha } from "@/lib/utils";

import { startInPersonSigning } from "../../esign/documents/actions";
import { LocalTime } from "../../esign/documents/_components/local-time";
import { ParticipantPill } from "../../esign/documents/_components/participant-line";
import { EventList } from "../../esign/documents/_components/progress-modal";

export type ViewerField = Pick<
  FieldRow,
  "id" | "participant_id" | "type" | "page" | "x" | "y" | "width" | "height" | "required" | "options" | "value" | "filled_at"
>;

interface ViewerDoc {
  id: string;
  title: string;
  status: DocStatus;
  request_type: RequestType;
  signing_order: SigningOrder;
  hasOriginal: boolean;
  hasCompleted: boolean;
  pageSizes: PageSize[];
}

const BASE_WIDTH = 816; // A4 page width on screen at "100%"
const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const A4_WIDTH_PT = 595.28;

const linkBtn =
  "inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded px-3.5 text-sm font-medium transition-colors";

export function DocumentViewer({
  wid,
  doc,
  info,
  fields,
  pdfUrl,
  myEmail,
  myToken,
  inPersonPending = [],
}: {
  wid: string;
  doc: ViewerDoc;
  info: ProgressInfo;
  fields: ViewerField[];
  pdfUrl: string | null;
  myEmail: string;
  myToken: string | null;
  /** pending 직접 대면 signers (managers only) */
  inPersonPending?: { id: string; name: string }[];
}) {
  const { doc: pdf, pageSizes, loading, error } = usePdfDocument(pdfUrl);
  const [inPersonBusy, startInPerson] = useTransition();
  const [zoomIndex, setZoomIndex] = useState(ZOOMS.indexOf(1));
  const [active, setActive] = useState(1);
  const scrollRef = useRef<HTMLElement>(null);
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);

  const [available, setAvailable] = useState(BASE_WIDTH);
  const zoom = ZOOMS[zoomIndex];
  // "100%" = 816px, or the width of the centre column when it is narrower
  const width = Math.round(Math.min(BASE_WIDTH, Math.max(360, available)) * zoom);
  const pageCount = pdf?.numPages ?? 0;
  const participants = useMemo(() => sortParticipants(info.participants), [info.participants]);
  const badge = documentBadge(doc, participants, myEmail);
  const view = doc.request_type === "view";

  const colorOf = useMemo(() => {
    const map = new Map<string, { color: string; name: string }>();
    participants.forEach((p, i) => map.set(p.id, { color: participantColor(i), name: p.name || p.email || `참여자 ${i + 1}` }));
    return map;
  }, [participants]);

  const fieldsByPage = useMemo(() => {
    const map = new Map<number, ViewerField[]>();
    for (const f of fields) map.set(f.page, [...(map.get(f.page) ?? []), f]);
    return map;
  }, [fields]);

  // track the centre column width (fit-to-width on narrow screens)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setAvailable(el.clientWidth - 48));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // highlight the thumbnail of the page that is most visible
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || !pageCount) return;
    const ratios = new Map<number, number>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) ratios.set(Number((e.target as HTMLElement).dataset.page), e.intersectionRatio);
        let best = 1;
        let bestRatio = -1;
        ratios.forEach((r, p) => {
          if (r > bestRatio) {
            bestRatio = r;
            best = p;
          }
        });
        setActive(best);
      },
      { root, threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] },
    );
    pageRefs.current.slice(0, pageCount).forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, [pageCount, width]);

  const scrollToPage = (n: number) => {
    setActive(n);
    pageRefs.current[n - 1]?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-body-2">
      {/* top bar */}
      <header className="flex h-16 shrink-0 items-center gap-3 border-b border-line bg-surface pl-3 pr-4">
        <Link
          href={documentsHome(wid)}
          aria-label="문서함으로 돌아가기"
          title="문서함으로 돌아가기"
          className="flex size-10 shrink-0 items-center justify-center rounded-full text-fg-2 transition-colors hover:bg-btn-light"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="min-w-0 truncate text-base font-bold text-fg" title={doc.title}>
          {doc.title}
        </h1>
        <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          {myToken && (
            <Link href={`/sign/${myToken}`} className={cn(linkBtn, "bg-primary text-primary-fg shadow-button hover:bg-primary-hover")}>
              <PenLine className="size-4" />
              {view ? "열람하기" : "서명하기"}
            </Link>
          )}
          {inPersonPending.map((p) => (
            <button
              key={p.id}
              type="button"
              disabled={inPersonBusy}
              title={`${p.name}님이 이 기기에서 ${view ? "열람" : "서명"}합니다.`}
              onClick={() =>
                startInPerson(async () => {
                  const res = await startInPersonSigning(wid, doc.id, p.id);
                  if (res && !res.ok) toast.error(res.error);
                })
              }
              className={cn(linkBtn, "bg-primary text-primary-fg shadow-button hover:bg-primary-hover disabled:opacity-60")}
            >
              <PenLine className="size-4" />
              직접 대면 {view ? "열람" : "서명"} 시작 ({p.name})
            </button>
          ))}
          {doc.hasOriginal && (
            <a href={downloadHref(doc.id, "original")} className={cn(linkBtn, "bg-btn-light text-fg-2 shadow-button hover:bg-btn-base")}>
              <Download className="size-4" />
              원본 다운로드
            </a>
          )}
          {doc.hasCompleted && (
            <a href={downloadHref(doc.id, "completed")} className={cn(linkBtn, "bg-btn-light text-fg-2 shadow-button hover:bg-btn-base")}>
              <FileDown className="size-4" />
              완료 문서 다운로드
            </a>
          )}
          <span className="mx-2 h-[22px] w-px bg-line" aria-hidden />
          <button
            type="button"
            aria-label="축소"
            title="축소"
            disabled={zoomIndex === 0}
            onClick={() => setZoomIndex((i) => Math.max(0, i - 1))}
            className="flex size-9 items-center justify-center rounded-full text-icon-2 transition-colors hover:bg-btn-light disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <CircleMinus className="size-[24px]" strokeWidth={1.6} />
          </button>
          <button
            type="button"
            aria-label="확대"
            title="확대"
            disabled={zoomIndex === ZOOMS.length - 1}
            onClick={() => setZoomIndex((i) => Math.min(ZOOMS.length - 1, i + 1))}
            className="flex size-9 items-center justify-center rounded-full text-icon-2 transition-colors hover:bg-btn-light disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <CirclePlus className="size-[24px]" strokeWidth={1.6} />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* thumbnails */}
        <aside aria-label="페이지 목록" className="w-[114px] shrink-0 overflow-y-auto border-r border-line bg-surface p-3">
          <div className="flex flex-col items-center gap-3">
            {Array.from({ length: pageCount }, (_, i) => (
              <PdfThumbnail
                key={i}
                doc={pdf}
                pageNumber={i + 1}
                width={90}
                active={active === i + 1}
                onClick={() => scrollToPage(i + 1)}
                label={
                  <span className="pointer-events-none absolute left-1.5 top-1 text-xl font-bold leading-none text-avatar-fg">{i + 1}</span>
                }
              />
            ))}
          </div>
        </aside>

        {/* pages */}
        <main ref={scrollRef} className="min-w-0 flex-1 overflow-auto" aria-label="문서 내용">
          {!pdfUrl ? (
            <CenterState icon={<FileX className="size-9 text-fg-faint" />} title="표시할 문서 파일이 없습니다." />
          ) : loading ? (
            <CenterState icon={<LoaderCircle className="size-8 animate-spin text-fg-muted" />} title="문서를 불러오는 중입니다." />
          ) : error || !pdf ? (
            <CenterState
              icon={<CircleAlert className="size-9 text-negative" />}
              title="문서를 불러오지 못했습니다."
              description="링크가 만료되었을 수 있습니다. 페이지를 새로 고쳐 다시 시도하세요."
            />
          ) : (
            <div className="flex min-w-max flex-col items-center gap-[30px] px-6 py-[30px]">
              {Array.from({ length: pageCount }, (_, i) => {
                const n = i + 1;
                const pageW = pageSizes[i]?.w ?? doc.pageSizes[i]?.w ?? A4_WIDTH_PT;
                const scale = width / pageW;
                return (
                  <div
                    key={n}
                    data-page={n}
                    ref={(el) => {
                      pageRefs.current[i] = el;
                    }}
                    className="scroll-mt-[30px]"
                  >
                    <PdfPageView
                      doc={pdf}
                      pageNumber={n}
                      width={width}
                      footer={
                        <span style={{ fontSize: Math.max(6, 7 * zoom) }}>
                          OpenSign Document ID : {doc.id} - {n} / {pageCount}
                        </span>
                      }
                    >
                      {(fieldsByPage.get(n) ?? []).map((f) => (
                        <FieldBox key={f.id} field={f} scale={scale} owner={f.participant_id ? colorOf.get(f.participant_id) : undefined} />
                      ))}
                    </PdfPageView>
                  </div>
                );
              })}
            </div>
          )}
        </main>

        {/* info panel */}
        <aside aria-label="문서 정보" className="w-[320px] shrink-0 overflow-y-auto border-l border-line bg-surface">
          <section className="border-b border-line px-5 py-5">
            <h2 className="text-[15px] font-bold text-fg">문서 정보</h2>
            <dl className="mt-3 space-y-2 text-[13px]">
              <InfoRow label="요청자">
                {info.requester ? (
                  <>
                    {info.requester.name}
                    <span className="block truncate text-xs font-normal text-fg-muted">{info.requester.email}</span>
                  </>
                ) : (
                  "-"
                )}
              </InfoRow>
              <InfoRow label="요청일">
                <LocalTime iso={info.doc.requested_at} variant="dash" />
              </InfoRow>
              <InfoRow label="체결일">
                <LocalTime iso={info.doc.completed_at} variant="dash" />
              </InfoRow>
              <InfoRow label="진행 방식">
                {view ? "열람 요청" : "서명 요청"} · {doc.signing_order === "sequential" ? "순차 진행" : "동시 진행"}
              </InfoRow>
              <InfoRow label="페이지">{pageCount || doc.pageSizes.length ? `${pageCount || doc.pageSizes.length}쪽` : "-"}</InfoRow>
            </dl>
          </section>

          <section className="border-b border-line px-5 py-5">
            <h2 className="text-[15px] font-bold text-fg">
              {view ? "열람자" : "서명자"} <span className="font-medium text-fg-muted">{participants.length}</span>
            </h2>
            {participants.length === 0 ? (
              <p className="mt-3 text-[13px] text-fg-muted">참여자가 없습니다.</p>
            ) : (
              <ul className="mt-3 space-y-3.5">
                {participants.map((p, i) => (
                  <li key={p.id} className="flex gap-2.5">
                    <span className="mt-[5px] size-2.5 shrink-0 rounded-full" style={{ background: participantColor(i) }} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1 text-sm font-bold text-fg">
                        <span className="truncate">
                          {doc.signing_order === "sequential" ? `${i + 1}. ` : ""}
                          {p.name || "이름 없음"}
                        </span>
                        {isMe(p, myEmail) && <span className="shrink-0 text-xs font-medium text-fg-faint">(나)</span>}
                      </p>
                      {p.email && <p className="truncate text-xs text-fg-muted">{p.email}</p>}
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <ParticipantPill p={p} requestType={doc.request_type} docStatus={doc.status} />
                        {doc.status === "in_progress" && (p.status === "pending" || p.status === "viewed") && p.expires_at && (
                          <span className="text-[11px] text-fg-faint">
                            기한 <LocalTime iso={p.expires_at} variant="dash" />
                          </span>
                        )}
                      </div>
                      {p.status === "rejected" && p.reject_reason && (
                        <p className="mt-1.5 rounded bg-negative-bg px-2 py-1 text-xs text-negative">사유: {p.reject_reason}</p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="px-5 py-5">
            <h2 className="mb-3 text-[15px] font-bold text-fg">진행 이력</h2>
            <EventList events={[...info.events].reverse()} compact />
          </section>
        </aside>
      </div>
    </div>
  );
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="w-[64px] shrink-0 text-fg-muted">{label}</dt>
      <dd className="min-w-0 flex-1 break-all font-bold text-fg-2">{children}</dd>
    </div>
  );
}

function CenterState({ icon, title, description }: { icon: ReactNode; title: string; description?: string }) {
  return (
    <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-3 px-6 text-center" role="status">
      {icon}
      <p className="text-sm font-bold text-fg-2">{title}</p>
      {description && <p className="text-[13px] text-fg-muted">{description}</p>}
    </div>
  );
}

/** One field on the page: filled → its value; unfilled → outlined box in the participant colour with the type icon. */
function FieldBox({ field, scale, owner }: { field: ViewerField; scale: number; owner?: { color: string; name: string } }) {
  const style = { left: field.x * scale, top: field.y * scale, width: field.width * scale, height: field.height * scale };
  const filled = field.type === "checkbox" ? !!field.filled_at || field.value === "true" : !!field.value;
  const meta = FIELD_META[field.type];

  if (filled) {
    return (
      <div
        className={cn("absolute", field.type === "checkbox" && "rounded-[2px] border border-avatar-fg")}
        style={style}
        title={owner ? `${owner.name} · ${meta.label}` : meta.label}
      >
        <FieldValue field={field} scale={scale} />
      </div>
    );
  }

  const color = owner?.color ?? "#949494";
  const Icon = meta.icon;
  const iconSize = Math.max(10, Math.min(22, Math.min(style.width, style.height) * 0.6));
  return (
    <div
      className="absolute flex items-center justify-center rounded-[2px] border"
      style={{ ...style, borderColor: color, background: withAlpha(color, 0.14) }}
      title={`${owner?.name ?? "참여자 미지정"} · ${meta.label}${field.required ? " (필수)" : ""}`}
    >
      <Icon style={{ color, width: iconSize, height: iconSize }} strokeWidth={2.2} aria-hidden />
      <span className="sr-only">
        {owner?.name} {meta.label} 미입력
      </span>
    </div>
  );
}
