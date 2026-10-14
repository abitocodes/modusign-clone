"use client";

import {
  Bell,
  BellRing,
  ChevronRight,
  CircleX,
  Download,
  Ellipsis,
  Eye,
  EyeOff,
  FileDown,
  FileOutput,
  FileSearch,
  FileText,
  Info,
  LogOut,
  Mail,
  Pencil,
  PenLine,
  Plus,
  Send,
  Tag,
  Trash2,
  UserPlus,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";

import { StatusBadge } from "@/components/ui/badge";
import { Avatar, Checkbox } from "@/components/ui/controls";
import { Cell, TableRow } from "@/components/ui/list-page";
import { Dropdown, MenuDivider, MenuItem } from "@/components/ui/menu";
import {
  anyoneActed,
  CANCELLABLE_STATUSES,
  downloadHref,
  isMe,
  sortParticipants,
  statusSentence,
  viewerHref,
  wizardHref,
  type DocListItem,
} from "@/lib/documents/view";
import type { Label } from "@/lib/types";
import { cn, documentBadge } from "@/lib/utils";

import { startInPersonSigning } from "../actions";
import { LocalTime } from "../_components/local-time";
import { ParticipantLine } from "../_components/participant-line";

import { COL, PANEL_LEFT } from "./columns";

export type RowCommand = "progress" | "cancel" | "labels" | "delete" | "modify" | "remind" | "hide" | "unhide";

const soon = (what: string) => toast(`${what} 기능은 준비 중입니다.`);
/** approximate height of the kebab menu (≈ 12 items + dividers) */
const MENU_HEIGHT = 440;
/** 내용 수정 is offered for sent / scheduled requests */
const cancellable = (d: DocListItem) => d.status === "in_progress" || d.status === "scheduled";
/** 서명 요청 취소 also for a request that is being modified (its signers were notified) */
const canCancel = (d: DocListItem) => CANCELLABLE_STATUSES.includes(d.status);
const inWizard = (d: DocListItem) => d.status === "draft" || d.status === "on_modifying";

export function DocumentRow({
  wid,
  doc,
  labels,
  myEmail,
  open,
  modalOpen,
  busy,
  selected,
  onSelect,
  onToggle,
  onClose,
  onCommand,
  onPanelExtent,
}: {
  wid: string;
  doc: DocListItem;
  labels: Label[];
  myEmail: string;
  open: boolean;
  modalOpen: boolean;
  busy: boolean;
  selected: boolean;
  onSelect: (on: boolean) => void;
  onToggle: () => void;
  onClose: () => void;
  onCommand: (cmd: RowCommand) => void;
  /** px from the top of the table body to the bottom of the open panel (0 when closed) */
  onPanelExtent: (px: number) => void;
}) {
  const router = useRouter();
  const wrapRef = useRef<HTMLDivElement>(null);
  const badge = documentBadge(doc, doc.participants, myEmail);
  const names = sortParticipants(doc.participants)
    .map((p) => p.name || p.email || "")
    .filter(Boolean)
    .join(",");
  const docLabels = doc.label_ids.map((id) => labels.find((l) => l.id === id)).filter((l): l is Label => !!l);

  // close the expand panel on outside click / Escape (not while a modal opened from it is showing)
  useEffect(() => {
    if (!open || modalOpen) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, modalOpen, onClose]);

  const onRowClick = () => {
    if (inWizard(doc) && doc.canManage) {
      router.push(wizardHref(wid, doc.id));
      return;
    }
    onToggle();
  };

  return (
    <div ref={wrapRef} className="relative">
      <TableRow
        onClick={onRowClick}
        className={cn("h-[72px]", open && "bg-surface-4 hover:bg-surface-4")}
        leading={<Checkbox aria-label={`${doc.title} 선택`} checked={selected} onChange={onSelect} />}
      >
        <Cell width={COL.status.width} className={COL.status.className}>
          <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
        </Cell>
        <Cell className={COL.title.className}>
          <div
            role="button"
            tabIndex={0}
            aria-expanded={inWizard(doc) && doc.canManage ? undefined : open}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onRowClick();
              }
            }}
            className="rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-emphasis"
          >
            <p className="flex items-center gap-1.5 text-sm font-bold text-fg">
              <span className="truncate" title={doc.title}>
                {doc.title}
              </span>
              {doc.hidden && <EyeOff className="size-3.5 shrink-0 text-fg-faint" aria-label="숨긴 문서" />}
            </p>
            <p className="mt-0.5 truncate text-[13px] text-fg-muted">{names || "참여자 없음"}</p>
          </div>
        </Cell>
        <Cell width={COL.label.width} className={COL.label.className}>
          {docLabels.length ? (
            <div className="flex flex-wrap gap-1">
              {docLabels.slice(0, 2).map((l) => (
                <span key={l.id} className="inline-flex h-[22px] max-w-[120px] items-center gap-1 rounded border border-line-strong px-1.5 text-xs text-fg-2">
                  <span className="size-2 shrink-0 rounded-full" style={{ background: l.color }} aria-hidden />
                  <span className="truncate">{l.name}</span>
                </span>
              ))}
              {docLabels.length > 2 && (
                <span className="inline-flex h-[22px] items-center rounded border border-line-strong px-1.5 text-xs text-fg-muted" title={docLabels.slice(2).map((l) => l.name).join(", ")}>
                  +{docLabels.length - 2}
                </span>
              )}
            </div>
          ) : (
            <span className="flex items-center gap-1.5 text-[13px] text-fg-muted">
              <Tag className="size-3.5" />
              라벨 없음
            </span>
          )}
        </Cell>
        <Cell width={COL.shared.width} className={COL.shared.className}>
          <div className="flex items-center">
            {doc.owner && (
              <span title={`요청자: ${doc.owner.name}`} className="rounded-full ring-2 ring-surface">
                <Avatar name={doc.owner.name} size={24} color={doc.owner.avatar_color} />
              </span>
            )}
            <button
              type="button"
              aria-label="공유하기"
              onClick={(e) => {
                e.stopPropagation();
                soon("문서 공유");
              }}
              className="-ml-1 flex size-6 items-center justify-center rounded-full border border-line-strong bg-btn-light text-fg-2 hover:bg-btn-base"
            >
              <Plus className="size-3.5" />
            </button>
          </div>
        </Cell>
        <Cell width={COL.requested.width} className={cn(COL.requested.className, "whitespace-nowrap text-[13px] text-fg-muted")}>
          <LocalTime iso={doc.requested_at} />
        </Cell>
        <Cell width={COL.completed.width} className={cn(COL.completed.className, "whitespace-nowrap text-[13px] text-fg-muted")}>
          <LocalTime iso={doc.completed_at} />
        </Cell>
        <Cell width={COL.activity.width} className={cn(COL.activity.className, "whitespace-nowrap text-[13px] text-fg-muted")}>
          <LocalTime iso={doc.last_activity_at} />
        </Cell>
        <Cell width={COL.menu.width} align="center">
          <div className="inline-flex" onClick={(e) => e.stopPropagation()}>
            <RowMenu wid={wid} doc={doc} busy={busy} onCommand={onCommand} />
          </div>
        </Cell>
      </TableRow>

      {open && <RowPanel wid={wid} doc={doc} myEmail={myEmail} onCommand={onCommand} onExtent={onPanelExtent} />}
    </div>
  );
}

/* --------------------------------------------------------- expand panel */

function PanelRow({
  icon,
  children,
  href,
  onClick,
  danger,
  chevron,
}: {
  icon: ReactNode;
  children: ReactNode;
  href?: string;
  onClick?: () => void;
  danger?: boolean;
  chevron?: boolean;
}) {
  const cls = cn(
    "flex h-[45px] w-full items-center gap-2 border-t border-line px-[26px] text-left text-sm font-medium text-fg-2 transition-colors hover:bg-menu-hover [&>svg:first-child]:size-4",
    danger && "text-negative",
  );
  const inner = (
    <>
      {icon}
      <span>{children}</span>
      {chevron && <ChevronRight className="size-3.5" strokeWidth={2.5} />}
    </>
  );
  return href ? (
    <Link href={href} className={cls}>
      {inner}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={cls}>
      {inner}
    </button>
  );
}

function RowPanel({
  wid,
  doc,
  myEmail,
  onCommand,
  onExtent,
}: {
  wid: string;
  doc: DocListItem;
  myEmail: string;
  onCommand: (cmd: RowCommand) => void;
  onExtent: (px: number) => void;
}) {
  const view = doc.request_type === "view";
  const sorted = sortParticipants(doc.participants);
  const panelRef = useRef<HTMLDivElement>(null);
  const [inPersonBusy, startInPerson] = useTransition();

  // The panel overlays the rows below it; report how far it reaches so the table body can grow
  // when it is opened on one of the last rows (keeps the surface + pagination below it).
  useEffect(() => {
    const el = panelRef.current;
    const group = el?.closest('[role="rowgroup"]');
    if (!el || !group) return;
    const ro = new ResizeObserver(() => {
      onExtent(Math.ceil(el.getBoundingClientRect().bottom - group.getBoundingClientRect().top) + 24);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      onExtent(0);
    };
  }, [onExtent]);

  return (
    <div
      ref={panelRef}
      className="absolute right-0 top-full z-20 -mt-px overflow-hidden border border-line-strong bg-menu shadow-menu"
      style={{ left: PANEL_LEFT }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="bg-surface-3 px-[26px] pb-3 pt-[26px]">
        <h5 className="text-base font-bold text-fg">{statusSentence(doc, doc.participants, myEmail)}</h5>
        {sorted.length > 0 && (
          <ol className="mt-2 space-y-0.5 pl-1">
            {sorted.map((p, i) => (
              <ParticipantLine
                key={p.id}
                p={p}
                index={i}
                order={doc.signing_order}
                requestType={doc.request_type}
                docStatus={doc.status}
                isMe={isMe(p, myEmail)}
              />
            ))}
          </ol>
        )}
        {doc.owner && (
          <p className="mt-3 text-right text-[13px] text-fg-disabled">
            {doc.owner.name}({doc.owner.email})
          </p>
        )}
      </div>
      <div>
        {doc.myToken ? (
          <>
            <PanelRow icon={<FileText />} href={`/sign/${doc.myToken}`} chevron>
              {view ? "내용 확인하고 열람하기" : "내용 확인하고 서명하기"}
            </PanelRow>
            {!view && (
              <PanelRow icon={<CircleX />} href={`/sign/${doc.myToken}?action=reject`}>
                거절
              </PanelRow>
            )}
          </>
        ) : (
          <PanelRow icon={<FileText />} href={viewerHref(wid, doc.id)} chevron>
            내용 확인
          </PanelRow>
        )}
        {doc.inPersonPending.map((p) => (
          <PanelRow
            key={p.id}
            icon={<PenLine />}
            chevron
            onClick={() =>
              startInPerson(async () => {
                const res = await startInPersonSigning(wid, doc.id, p.id);
                if (res && !res.ok) toast.error(res.error);
              })
            }
          >
            {inPersonBusy ? `${view ? "열람" : "서명"} 화면을 여는 중…` : `직접 대면 ${view ? "열람" : "서명"} 시작 (${p.name})`}
          </PanelRow>
        ))}
        {doc.canManage && cancellable(doc) && !anyoneActed(doc.participants) && (
          <PanelRow icon={<Pencil />} onClick={() => onCommand("modify")} chevron>
            내용 수정
          </PanelRow>
        )}
        {doc.canManage && canCancel(doc) && (
          <PanelRow icon={<CircleX />} danger onClick={() => onCommand("cancel")}>
            서명 요청 취소
          </PanelRow>
        )}
        <PanelRow icon={<Info />} onClick={() => onCommand("progress")}>
          진행 정보 확인
        </PanelRow>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ kebab */

function RowMenu({ wid, doc, busy, onCommand }: { wid: string; doc: DocListItem; busy: boolean; onCommand: (cmd: RowCommand) => void }) {
  const router = useRouter();
  const completed = doc.status === "completed";
  // open upwards when the menu would not fit below the button (rows near the bottom of the screen)
  const [dropUp, setDropUp] = useState(false);
  return (
    <Dropdown
      align="right"
      offset={dropUp ? 0 : 6}
      panelClassName={cn("w-[196px]", dropUp && "bottom-full top-auto mb-1.5")}
      trigger={(open, toggle) => (
        <button
          type="button"
          aria-label={`${doc.title} 추가 메뉴`}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={(e) => {
            if (!open) {
              const r = e.currentTarget.getBoundingClientRect();
              setDropUp(window.innerHeight - r.bottom < MENU_HEIGHT && r.top > window.innerHeight - r.bottom);
            }
            toggle();
          }}
          className={cn(
            "flex size-8 items-center justify-center rounded-lg border border-line-strong text-fg-2 transition-colors hover:bg-btn-light",
            open && "bg-btn-light",
          )}
        >
          <Ellipsis className="size-4" />
        </button>
      )}
    >
      {(close) => {
        const run = (fn: () => void) => () => {
          close();
          fn();
        };
        return (
          <>
            {inWizard(doc) && doc.canManage ? (
              <MenuItem icon={<Pencil />} onClick={run(() => router.push(wizardHref(wid, doc.id)))}>
                이어서 작성하기
              </MenuItem>
            ) : (
              <MenuItem icon={<Eye />} onClick={run(() => router.push(viewerHref(wid, doc.id)))}>
                문서 보기
              </MenuItem>
            )}
            {doc.hasOriginal && (
              <MenuItem icon={<Download />} onClick={run(() => window.location.assign(downloadHref(doc.id, "original")))}>
                원본 다운로드
              </MenuItem>
            )}
            {doc.hasCompleted && (
              <MenuItem icon={<FileDown />} onClick={run(() => window.location.assign(downloadHref(doc.id, "completed")))}>
                완료 문서 다운로드
              </MenuItem>
            )}
            {completed && (
              <MenuItem icon={<Mail />} onClick={run(() => soon("이메일로 전달"))}>
                이메일로 전달
              </MenuItem>
            )}
            {doc.canManage && doc.status === "in_progress" && (
              <MenuItem icon={<BellRing />} disabled={busy} onClick={run(() => onCommand("remind"))}>
                리마인드 보내기
              </MenuItem>
            )}
            <MenuItem icon={<Bell />} onClick={run(() => soon("계약 리마인더"))}>
              계약 리마인더
            </MenuItem>
            {completed && (
              <MenuItem icon={<Send />} onClick={run(() => soon("복제 후 새 서명 요청"))}>
                복제 후 새 서명 요청
              </MenuItem>
            )}
            <MenuDivider />
            <MenuItem icon={<FileSearch />} onClick={run(() => soon("추출 데이터 미리보기"))}>
              추출 데이터 미리보기
            </MenuItem>
            <MenuItem icon={<FileOutput />} onClick={run(() => router.push(`/workspaces/${wid}/esign/documents/data-export`))}>
              데이터 추출
            </MenuItem>
            <MenuDivider />
            <MenuItem icon={<UserPlus />} onClick={run(() => soon("문서 공유"))}>
              공유
            </MenuItem>
            {doc.canManage && (
              <>
                <MenuItem icon={<Tag />} onClick={run(() => onCommand("labels"))}>
                  라벨 설정
                </MenuItem>
                <MenuItem icon={doc.hidden ? <Eye /> : <EyeOff />} disabled={busy} onClick={run(() => onCommand(doc.hidden ? "unhide" : "hide"))}>
                  {doc.hidden ? "숨김 해제" : "숨기기"}
                </MenuItem>
              </>
            )}
            {doc.isOwner && doc.status === "draft" && (
              <MenuItem icon={<Trash2 />} danger onClick={run(() => onCommand("delete"))}>
                삭제
              </MenuItem>
            )}
            <MenuDivider />
            <MenuItem icon={<LogOut />} onClick={run(() => soon("문서 이전"))}>
              이전
            </MenuItem>
            {doc.canManage && canCancel(doc) && (
              <MenuItem icon={<CircleX />} danger onClick={run(() => onCommand("cancel"))}>
                서명 요청 취소
              </MenuItem>
            )}
          </>
        );
      }}
    </Dropdown>
  );
}
