"use client";

import { CircleHelp, CircleMinus, CirclePlus, CircleX, Download, Ellipsis, X } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Dropdown, MenuItem } from "@/components/ui/menu";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";

import type { SignMenu } from "../_lib/types";

/**
 * Top bar of the signer pages: h62 (cards) / h64 (document), "…" menu on the right
 * (서명 거절 / 문서 다운로드 / 도움말) with optional extra controls around it.
 */
export function SignTopBar({
  tall,
  menu,
  onReject,
  before,
  after,
}: {
  /** 64px (document screens) instead of 62px (cards) */
  tall?: boolean;
  menu?: SignMenu;
  onReject?: () => void;
  /** e.g. 임시저장 */
  before?: ReactNode;
  /** e.g. zoom buttons */
  after?: ReactNode;
}) {
  const [help, setHelp] = useState(false);
  return (
    <header
      className={cn(
        "flex shrink-0 items-center justify-end gap-2 border-b border-line bg-surface px-3 sm:px-4",
        tall ? "h-16" : "h-[62px]",
      )}
    >
      {before}
      <Dropdown
        align="right"
        panelClassName="min-w-[168px]"
        trigger={(open, toggle) => (
          <button
            type="button"
            onClick={toggle}
            aria-label="더 보기"
            aria-haspopup="menu"
            aria-expanded={open}
            className={cn(
              "flex size-9 items-center justify-center rounded text-fg-2 transition-colors hover:bg-btn-light",
              open && "bg-btn-light",
            )}
          >
            <Ellipsis className="size-[18px]" />
          </button>
        )}
      >
        {(close) => (
          <>
            {menu?.canReject && onReject && (
              <MenuItem
                icon={<CircleX />}
                onClick={() => {
                  close();
                  onReject();
                }}
              >
                서명 거절
              </MenuItem>
            )}
            {menu?.downloadHref && (
              <MenuItem
                icon={<Download />}
                onClick={() => {
                  close();
                  window.location.href = menu.downloadHref!;
                }}
              >
                문서 다운로드
              </MenuItem>
            )}
            <MenuItem
              icon={<CircleHelp />}
              onClick={() => {
                close();
                setHelp(true);
              }}
            >
              도움말
            </MenuItem>
          </>
        )}
      </Dropdown>
      {after}
      <HelpModal open={help} onClose={() => setHelp(false)} />
    </header>
  );
}

/** "| ⊖ ⊕" zoom group of the document top bar */
export function ZoomButtons({
  onZoomIn,
  onZoomOut,
  canZoomIn,
  canZoomOut,
  percent,
}: {
  onZoomIn: () => void;
  onZoomOut: () => void;
  canZoomIn: boolean;
  canZoomOut: boolean;
  percent: number;
}) {
  const btn =
    "flex size-[31px] items-center justify-center rounded-full text-icon-2 transition-colors hover:bg-btn-light disabled:text-fg-disabled disabled:hover:bg-transparent";
  return (
    <>
      <span aria-hidden className="mx-1 h-[22px] w-px bg-line" />
      <button type="button" className={btn} onClick={onZoomOut} disabled={!canZoomOut} aria-label="축소" title="축소">
        <CircleMinus className="size-[22px]" strokeWidth={1.6} />
      </button>
      <span className="sr-only" aria-live="polite">
        {percent}%
      </span>
      <button type="button" className={btn} onClick={onZoomIn} disabled={!canZoomIn} aria-label="확대" title="확대">
        <CirclePlus className="size-[22px]" strokeWidth={1.6} />
      </button>
    </>
  );
}

const HELP_ITEMS = [
  "‘서명 시작하기’를 누르면 내가 입력해야 할 입력란으로 차례대로 안내합니다.",
  "노란색 ‘다음’ 표시나 하단의 ‘다음으로’ 버튼을 누르면 다음 입력란으로 이동합니다.",
  "사인·도장 입력란을 누르면 사인을 그리거나 만들고, 도장을 선택할 수 있습니다.",
  "‘임시저장’을 누르면 입력한 내용이 저장되어 같은 링크로 나중에 이어서 진행할 수 있습니다.",
  "입력을 마치면 ‘입력 완료’를 눌러 내용을 확인하고 전자서명에 동의합니다.",
  "문서 내용에 문제가 있다면 ‘…’ 메뉴의 ‘서명 거절’을 선택하고 사유를 남겨 주세요.",
];

export function HelpModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <InfoModal open={open} onClose={onClose} title="서명 진행 도움말">
      <ul className="space-y-2.5">
        {HELP_ITEMS.map((t) => (
          <li key={t} className="flex gap-2 text-[13px] leading-relaxed text-fg">
            <span aria-hidden className="mt-[7px] size-1 shrink-0 rounded-full bg-fg-muted" />
            {t}
          </li>
        ))}
      </ul>
      <p className="mt-5 text-[13px] text-fg-muted">그 밖의 문의는 서명을 요청한 담당자에게 연락해 주세요.</p>
    </InfoModal>
  );
}

/** small titled information dialog (도움말, 이용약관) */
export function InfoModal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  return (
    <Modal open={open} onClose={onClose} width={480}>
      <div className="relative px-[30px] pb-[30px] pt-[30px]">
        <button
          type="button"
          aria-label="닫기"
          onClick={onClose}
          className="absolute right-3 top-3 flex size-[34px] items-center justify-center rounded-lg text-icon-2 hover:bg-btn-light"
        >
          <X className="size-5" />
        </button>
        <h2 className="pr-8 text-lg font-bold text-fg">{title}</h2>
        <div className="mt-5 rounded border border-line-strong bg-surface-3 p-[22px]">{children}</div>
        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded bg-primary px-[22px] text-sm font-bold text-primary-fg shadow-button hover:bg-primary-hover"
          >
            확인
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Full page frame of the card screens (본인 확인, 상태 안내, 서명 완료). */
export function CardPage({ menu, onReject, children }: { menu?: SignMenu; onReject?: () => void; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-body-2">
      <SignTopBar menu={menu} onReject={onReject} />
      <main className="flex flex-1 flex-col items-center px-4 pb-16 pt-3">{children}</main>
    </div>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cn("w-full rounded-xl border border-line bg-surface", className)}>{children}</section>;
}
