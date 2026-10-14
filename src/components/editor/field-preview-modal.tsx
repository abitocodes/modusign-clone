"use client";

import { ChevronDown, Eye, LoaderCircle, TriangleAlert } from "lucide-react";
import { useState } from "react";

import { PdfPageView, usePdfDocument } from "@/components/pdf/pdf";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { UnderlineTabs } from "@/components/ui/tabs";
import { isUserFillable } from "@/lib/fields";
import { cn, isoDay, participantColor, withAlpha } from "@/lib/utils";

import { BASE_SCALE, clamp, fieldFontSize, type EditorField, type EditorParticipant, type PageSize } from "./editor-model";
import { SIGN_MODE_ICONS } from "./field-box";

/** Preview pages are drawn at 88 % of the editor's 100 % size (A4 → 718px) to fit the dialog. */
const PREVIEW_SCALE = BASE_SCALE * 0.88;

/** One field as the signer sees it before filling it in (signing mode, nothing entered yet). */
function SignerField({
  field,
  color,
  scale,
  participantName,
  today,
}: {
  field: EditorField;
  color: string;
  scale: number;
  participantName: string;
  today: string;
}) {
  const w = field.width * scale;
  const h = field.height * scale;
  const o = field.options;
  const fs = fieldFontSize(field) * scale;
  const pos = { left: field.x * scale, top: field.y * scale, width: w, height: h };

  if (field.type === "signed_date") {
    return (
      <div className="absolute flex items-center overflow-hidden whitespace-nowrap leading-none text-[#292929]" style={{ ...pos, fontSize: fs }}>
        {today}
      </div>
    );
  }

  const boxed = { ...pos, border: `1px solid ${color}` };

  if (field.type === "signature") {
    const Icon = SIGN_MODE_ICONS[o.signMode ?? "any"];
    const s = clamp(Math.min(w, h) * 0.24, 10, 32);
    return (
      <div className="absolute flex items-center justify-center bg-white/75" style={boxed}>
        <Icon style={{ width: s, height: s, color }} strokeWidth={2.4} />
      </div>
    );
  }

  if (field.type === "checkbox") {
    return <div className="absolute bg-white" style={boxed} />;
  }

  if (field.type === "image") {
    return (
      <div className="absolute flex items-center justify-center text-[11px] font-medium text-[#474747]" style={{ ...boxed, background: withAlpha(color, 0.2) }}>
        이미지 첨부
      </div>
    );
  }

  // text-like: prefilled value (자동 입력 이름 / 기본 텍스트) or the guide text in grey
  const prefilled = o.autoFill === "name" ? participantName : field.type === "text" ? o.defaultText ?? "" : "";
  const guide =
    field.type === "transcribe"
      ? o.sentence || o.placeholder || "따라쓰기"
      : field.type === "date"
        ? o.placeholder || "YYYY-MM-DD"
        : field.type === "dropdown"
          ? o.placeholder || "선택"
          : o.placeholder || "";
  return (
    <div
      className={cn(
        "absolute flex overflow-hidden px-[2px] leading-tight",
        field.type === "transcribe" ? "items-start whitespace-normal py-[2px]" : "items-center whitespace-nowrap",
      )}
      style={{ ...boxed, background: withAlpha(color, 0.2), fontSize: fs }}
    >
      <span className={cn("min-w-0 truncate", prefilled ? "text-[#292929]" : "text-[#9e9e9e]", field.type === "transcribe" && "whitespace-normal")}>
        {prefilled || guide}
      </span>
      {field.type === "dropdown" && <ChevronDown className="ml-auto shrink-0 text-[#474747]" style={{ width: fs, height: fs }} strokeWidth={2.4} />}
    </div>
  );
}

/**
 * 미리보기: renders the document pages with the fields of ONE participant as that signer
 * would see them (other participants' empty fields are hidden). Tabs switch participants.
 */
export function FieldPreviewModal({
  open,
  onClose,
  pdfUrl,
  pageSizes,
  participants,
  fields,
  documentId,
}: {
  open: boolean;
  onClose: () => void;
  pdfUrl: string;
  pageSizes: PageSize[];
  participants: EditorParticipant[];
  fields: EditorField[];
  /** stamped in the page footer like on the signer screen */
  documentId?: string;
}) {
  const [activeKey, setActiveKey] = useState(participants[0]?.key ?? "");
  const [today] = useState(() => isoDay());
  const current = participants.find((p) => p.key === activeKey) ?? participants[0];
  const pdf = usePdfDocument(open ? pdfUrl : null);
  const sizes = pdf.pageSizes.length ? pdf.pageSizes : pageSizes;

  const mine = current ? fields.filter((f) => f.participantKey === current.key) : [];
  const toFill = mine.filter((f) => isUserFillable(f.type) && f.required && f.options.autoFill !== "name").length;
  const color = participantColor(current?.colorIndex ?? 0);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="미리보기"
      icon={<Eye />}
      width={1040}
      footerBar
      footer={
        <Button variant="neutral" size="md" className="h-10 min-w-20" onClick={onClose}>
          닫기
        </Button>
      }
    >
      {/* the shadow covers the 1px seam that sub-pixel scrolling can leave above a sticky bar */}
      <div className="sticky top-0 z-10 bg-modal shadow-[0_-2px_0_var(--modal)]">
        {participants.length > 1 && (
          <UnderlineTabs
            className="bg-modal"
            value={current?.key ?? ""}
            onChange={setActiveKey}
            tabs={participants.map((p) => ({
              value: p.key,
              label: (
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden className="size-2.5 rounded-[2px]" style={{ background: participantColor(p.colorIndex) }} />
                  {p.name || "이름 없음"}
                </span>
              ),
            }))}
          />
        )}

        <div className="flex items-center gap-2 border-b border-line-light bg-modal-head px-6 py-3 text-[13px]">
          <span aria-hidden className="size-2.5 shrink-0 rounded-[2px]" style={{ background: color }} />
          <span className="min-w-0 flex-1 truncate text-fg-2">
            <b className="font-bold text-fg">{current?.name || "서명자"}</b>님에게 보이는 화면입니다. 다른 참여자의 입력란은 표시되지 않습니다.
          </span>
          <span className="shrink-0 text-fg-muted">
            {mine.length === 0 ? (
              "배치된 입력란이 없습니다."
            ) : (
              <>
                완성해야 할 입력란 <b className="font-bold text-fg">{toFill}</b>개
              </>
            )}
          </span>
        </div>
      </div>

      <div className="bg-body-2 px-6 py-6">
        {pdf.error ? (
          <div className="flex h-64 flex-col items-center justify-center gap-2 text-sm text-fg-muted">
            <TriangleAlert className="size-6 text-negative" />
            문서를 불러오지 못했습니다.
          </div>
        ) : !sizes.length ? (
          <div className="flex h-64 items-center justify-center gap-2 text-sm text-fg-muted">
            <LoaderCircle className="size-5 animate-spin" /> 문서를 불러오는 중…
          </div>
        ) : (
          <div className="flex flex-col items-center gap-6">
            {sizes.map((size, i) => {
              const page = i + 1;
              const w = size.w * PREVIEW_SCALE;
              return (
                <div key={page} className="relative shrink-0" style={{ width: w, height: size.h * PREVIEW_SCALE }}>
                  {pdf.loading && i === 0 && (
                    <div className="pointer-events-none absolute inset-x-0 top-6 z-10 flex justify-center">
                      <span className="flex items-center gap-1.5 rounded-full bg-menu px-3 py-1 text-xs text-fg-2 shadow-menu">
                        <LoaderCircle className="size-3.5 animate-spin" /> 문서를 불러오는 중…
                      </span>
                    </div>
                  )}
                  <PdfPageView
                    doc={pdf.doc}
                    pageNumber={page}
                    width={w}
                    className="!h-full"
                    footer={documentId ? `OpenSign Document ID : ${documentId} - ${page} / ${sizes.length}` : undefined}
                  >
                    {mine
                      .filter((f) => f.page === page)
                      .map((f) => (
                        <SignerField
                          key={f.id}
                          field={f}
                          color={color}
                          scale={PREVIEW_SCALE}
                          participantName={current?.name ?? ""}
                          today={today}
                        />
                      ))}
                  </PdfPageView>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}
