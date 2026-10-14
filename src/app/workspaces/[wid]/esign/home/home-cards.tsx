"use client";

import { ArrowUpRight, ChevronLeft, ChevronRight, LayoutTemplate, Send, UserCheck } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Fragment, useEffect, useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dropdown, MenuItem } from "@/components/ui/menu";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";

import { CabinetArt, ShieldArt, TemplateArt } from "./home-art";
import { PERIOD_OPTIONS, type PeriodKey } from "./period";

export function HomeCard({ title, children, className, action }: { title: string; children: ReactNode; className?: string; action?: ReactNode }) {
  return (
    <section className={cn("rounded-xl border border-line bg-surface p-6", className)} aria-label={title}>
      <div className="flex items-center gap-[22px]">
        <h2 className="text-lg font-medium text-fg">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/* ================================================================ 진행 현황 */

export interface HomeStat {
  key: string;
  label: string;
  dotClass: string;
  count: number;
  href: string;
}

export function ProgressCard({
  stats,
  period,
  error,
}: {
  stats: HomeStat[];
  period: { key: PeriodKey; label: string; fromDay: string; toDay: string };
  error: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [customOpen, setCustomOpen] = useState(false);

  const go = (query: string) => startTransition(() => router.push(query ? `${pathname}?${query}` : pathname, { scroll: false }));

  return (
    <HomeCard
      title="진행 현황"
      className="mt-[26px]"
      action={
        <Dropdown
          panelClassName="w-[136px]"
          trigger={(open, toggle) => (
            <button
              type="button"
              onClick={toggle}
              aria-haspopup="menu"
              aria-expanded={open}
              className={cn(
                "flex h-[38px] min-w-[120px] items-center justify-between gap-3 rounded border border-line bg-surface px-3 text-[13px] font-medium text-fg hover:bg-surface-3",
                open && "border-emphasis",
              )}
            >
              <span className="whitespace-nowrap">{period.label}</span>
              <svg width="8" height="5" viewBox="0 0 10 6" className="shrink-0 fill-icon-2" aria-hidden>
                <path d="M0 0h10L5 6z" />
              </svg>
            </button>
          )}
        >
          {(close) =>
            PERIOD_OPTIONS.map((o) => (
              <MenuItem
                key={o.value}
                className={cn("py-1.5", period.key === o.value && "bg-menu-hover")}
                onClick={() => {
                  close();
                  if (o.value === "custom") setCustomOpen(true);
                  else go(o.value === "30d" ? "" : `period=${o.value}`);
                }}
              >
                {o.label}
              </MenuItem>
            ))
          }
        </Dropdown>
      }
    >
      {error ? (
        <p className="mt-8 text-sm text-fg-muted">
          진행 현황을 불러오지 못했습니다.{" "}
          <button type="button" className="text-emphasis hover:underline" onClick={() => router.refresh()}>
            다시 시도
          </button>
        </p>
      ) : (
        <div className={cn("mt-[30px] grid grid-cols-2 gap-y-4 transition-opacity sm:grid-cols-4", pending && "opacity-50")} aria-busy={pending}>
          {stats.map((s) => (
            <Link
              key={s.key}
              href={s.href}
              className="group -my-2 mr-4 rounded-lg px-2.5 py-2 transition-colors hover:bg-surface-3"
              aria-label={`${s.label} ${s.count}건 — 문서함에서 보기`}
            >
              <span className="flex items-center gap-2 text-sm font-medium text-fg">
                <span className={cn("size-2 rounded-full", s.dotClass)} aria-hidden />
                {s.label}
              </span>
              <span className="mt-1 block text-[28px] font-medium leading-tight tabular-nums text-fg-strong group-hover:underline">
                {s.count.toLocaleString("ko-KR")}
              </span>
            </Link>
          ))}
        </div>
      )}
      {customOpen && (
        <CustomRangeModal
          initialFrom={period.fromDay}
          initialTo={period.toDay}
          onClose={() => setCustomOpen(false)}
          onApply={(from, to) => {
            setCustomOpen(false);
            go(`period=custom&from=${from}&to=${to}`);
          }}
        />
      )}
    </HomeCard>
  );
}

function CustomRangeModal({
  initialFrom,
  initialTo,
  onClose,
  onApply,
}: {
  initialFrom: string;
  initialTo: string;
  onClose: () => void;
  onApply: (from: string, to: string) => void;
}) {
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const invalid = !from || !to || from > to;
  return (
    <Modal
      open
      onClose={onClose}
      title="기간 직접 입력"
      width={440}
      footer={
        <>
          <Button variant="light" onClick={onClose}>
            취소
          </Button>
          <Button variant="primary" disabled={invalid} onClick={() => onApply(from, to)}>
            적용
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 px-[30px] pb-2 pt-6">
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-fg-2">시작일</span>
          <Input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-fg-2">종료일</span>
          <Input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
        </label>
        {from && to && from > to && <p className="col-span-2 text-xs text-negative">종료일은 시작일 이후여야 합니다.</p>}
        <p className="col-span-2 text-xs text-fg-muted">서명 요청일(요청 전 문서는 생성일) 기준으로 집계합니다.</p>
      </div>
    </Modal>
  );
}

/* ================================================================ 알아보기 */

interface Guide {
  key: string;
  label: string;
  icon: ReactNode;
  tile: string;
  square: string;
  iconColor: string;
  steps: string[];
  cta: { label: string; href: string };
}

export function LearnCard({ base }: { base: string }) {
  const [open, setOpen] = useState<Guide | null>(null);
  const guides: Guide[] = [
    {
      key: "request",
      label: "서명 요청 방법",
      icon: <Send className="size-[18px] -rotate-12" />,
      tile: "bg-warning-bg",
      square: "bg-[color-mix(in_srgb,var(--warning)_22%,white)]",
      iconColor: "text-warning-strong",
      steps: [
        "‘서명 요청 시작하기’를 누르고 서명받을 PDF 문서를 업로드해요.",
        "서명할 참여자의 이름과 이메일을 입력하고 서명 순서를 정해요.",
        "문서 위에 사인·도장, 텍스트, 날짜 등 입력란을 배치해요.",
        "요청 정보를 확인하고 전송하면 참여자에게 서명 요청 메일이 발송돼요.",
      ],
      cta: { label: "서명 요청 시작하기", href: `${base}/esign/requests/request` },
    },
    {
      key: "guide",
      label: "첫 이용자 가이드",
      icon: <UserCheck className="size-[18px]" />,
      tile: "bg-emphasis-bg",
      square: "bg-[color-mix(in_srgb,var(--emphasis)_14%,white)]",
      iconColor: "text-radio-on",
      steps: [
        "홈의 진행 현황에서 내 서명이 필요한 문서와 진행 중인 문서를 한눈에 확인해요.",
        "문서함에서 상태별로 문서를 찾고, 서명이 끝난 문서를 내려받아요.",
        "사인·도장을 미리 등록해 두면 서명할 때 바로 사용할 수 있어요.",
        "관리자는 통합 설정에서 멤버 계정과 워크스페이스를 관리해요.",
      ],
      cta: { label: "사인·도장 등록하기", href: `${base}/esign/requests/signatures` },
    },
    {
      key: "template",
      label: "템플릿 이용 방법",
      icon: <LayoutTemplate className="size-[18px]" />,
      tile: "bg-positive-bg",
      square: "bg-[color-mix(in_srgb,var(--positive)_16%,white)]",
      iconColor: "text-positive",
      steps: [
        "자주 쓰는 계약서를 템플릿으로 등록해요.",
        "서명자 역할(서명자 1, 서명자 2 …)과 입력란을 미리 배치해 두어요.",
        "템플릿을 사용하면 참여자 정보만 입력해 바로 서명을 요청할 수 있어요.",
      ],
      cta: { label: "템플릿 보러 가기", href: `${base}/esign/requests/templates` },
    },
  ];

  return (
    <HomeCard title="알아보기" className="mt-6">
      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {guides.map((g) => (
          <button
            key={g.key}
            type="button"
            onClick={() => setOpen(g)}
            className={cn("flex h-14 items-center gap-3 rounded-xl px-3 text-left transition-[filter] hover:brightness-125", g.tile)}
          >
            <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", g.square, g.iconColor)}>{g.icon}</span>
            <span className="flex-1 truncate text-sm font-medium text-fg">{g.label}</span>
            <ChevronRight className="size-4 shrink-0 text-fg-muted" />
          </button>
        ))}
      </div>
      <Modal
        open={!!open}
        onClose={() => setOpen(null)}
        title={open?.label}
        icon={open?.icon}
        width={520}
        footer={
          open && (
            <>
              <Button variant="light" onClick={() => setOpen(null)}>
                닫기
              </Button>
              <Link
                href={open.cta.href}
                onClick={() => setOpen(null)}
                className="inline-flex h-9 items-center rounded bg-primary px-3.5 text-sm font-medium text-primary-fg shadow-button hover:bg-primary-hover"
              >
                {open.cta.label}
              </Link>
            </>
          )
        }
      >
        {open && (
          <ol className="space-y-3 px-[30px] pb-2 pt-6">
            {open.steps.map((s, i) => (
              <li key={i} className="flex gap-3 text-sm leading-relaxed text-fg-2">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-btn-dark text-xs font-bold text-fg">{i + 1}</span>
                <span className="pt-0.5">{s}</span>
              </li>
            ))}
          </ol>
        )}
      </Modal>
    </HomeCard>
  );
}

/* ================================================================ 소식 */

const SLIDES = [
  { lead: "체결된 계약서, ", strong: "문서함에서 한눈에 관리하세요", art: <CabinetArt /> },
  { lead: "임직원 계정으로 ", strong: "안전하게 로그인하세요", art: <ShieldArt /> },
  { lead: "반복되는 계약은 ", strong: "템플릿으로 빠르게 보내세요", art: <TemplateArt /> },
];

const NEWS = [
  { title: "‘문서 편집기’ 기능 추가", date: "2026.10.12", body: "PDF 위에 텍스트·체크·화이트아웃을 더해 바로 서명 요청할 수 있어요." },
  { title: "‘서식 작성기’ PDF 변환 지원", date: "2026.09.30", body: "직접 작성한 서식을 A4 PDF로 변환해 서명 요청을 시작할 수 있어요." },
  { title: "‘진행 현황’ 기간 직접 입력 지원", date: "2026.09.03", body: "홈 진행 현황에서 원하는 기간을 직접 지정해 집계할 수 있어요." },
];

const ROTATE_MS = 5000;

export function NewsCard() {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setIndex((i) => (i + 1) % SLIDES.length), ROTATE_MS);
    return () => clearInterval(t);
  }, [paused]);

  const move = (d: number) => setIndex((i) => (i + d + SLIDES.length) % SLIDES.length);

  return (
    <HomeCard title="소식" className="mt-6">
      <div
        className="mt-5 flex items-center gap-1"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocus={() => setPaused(true)}
        onBlur={() => setPaused(false)}
      >
        <button type="button" aria-label="이전 소식" onClick={() => move(-1)} className="flex size-8 shrink-0 items-center justify-center rounded text-fg-disabled hover:text-fg">
          <ChevronLeft className="size-5" />
        </button>
        <div className="relative h-[104px] min-w-0 flex-1 overflow-hidden rounded-xl bg-surface-3" role="region" aria-roledescription="carousel" aria-label="소식 배너">
          <div className="flex h-full transition-transform duration-500 ease-out" style={{ transform: `translateX(-${index * 100}%)` }}>
            {SLIDES.map((s, i) => (
              <div
                key={i}
                role="group"
                aria-roledescription="slide"
                aria-label={`${i + 1} / ${SLIDES.length}`}
                aria-hidden={i !== index}
                className="flex h-full w-full shrink-0 items-center justify-between gap-4 pl-[38px] pr-8"
              >
                <p className="truncate text-lg text-fg">
                  {s.lead}
                  <b className="font-bold">{s.strong}</b>
                </p>
                <div className="hidden shrink-0 sm:block">{s.art}</div>
              </div>
            ))}
          </div>
          <div className="absolute bottom-[18px] left-[38px] flex gap-1.5">
            {SLIDES.map((_, i) => (
              <button
                key={i}
                type="button"
                aria-label={`${i + 1}번째 소식 보기`}
                aria-current={i === index}
                onClick={() => setIndex(i)}
                className={cn("size-1.5 rounded-full transition-colors", i === index ? "bg-fg" : "bg-line-strong hover:bg-fg-muted")}
              />
            ))}
          </div>
        </div>
        <button type="button" aria-label="다음 소식" onClick={() => move(1)} className="flex size-8 shrink-0 items-center justify-center rounded text-fg-disabled hover:text-fg">
          <ChevronRight className="size-5" />
        </button>
      </div>

      <ul className="mt-4">
        {NEWS.map((n) => (
          <li key={n.title} className="border-b border-line last:border-b-0">
            <button
              type="button"
              onClick={() => toast(n.title, { description: n.body })}
              className="flex h-16 w-full items-center justify-between gap-4 rounded px-3 text-left transition-colors hover:bg-surface-3"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-fg">{n.title}</span>
                <span className="mt-0.5 block text-xs text-fg-faint">{n.date}</span>
              </span>
              <ArrowUpRight className="size-4 shrink-0 text-icon-2" />
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex justify-center">
        <button
          type="button"
          onClick={() => toast("전체 소식은 준비 중입니다.")}
          className="flex h-9 items-center gap-1 rounded px-3 text-sm font-medium text-fg-muted hover:bg-surface-3 hover:text-fg-2"
        >
          전체보기
          <ArrowUpRight className="size-3.5" />
        </button>
      </div>
    </HomeCard>
  );
}

/* ================================================================ footer */

export function HomeFooter() {
  const links = ["이용약관", "개인정보처리방침", "고객센터"];
  return (
    <footer className="mt-12 flex flex-col justify-between gap-6 border-t border-line pb-14 pt-7 text-xs leading-[1.8] text-fg-muted sm:flex-row">
      <div>
        <p className="mb-1 text-[13px] font-bold text-fg-3">OpenSign</p>
        <p>대표 : 000 | 사업자등록번호 : 000-00-00000</p>
        <p>주소 : 서울특별시 00구 00로 00, 0층 (사내 전용 서비스)</p>
        <p>문의 : 사내 IT 지원팀</p>
      </div>
      <div className="sm:text-right">
        <div className="flex items-center gap-2.5 sm:justify-end">
          {links.map((l, i) => (
            <Fragment key={l}>
              {i > 0 && <span aria-hidden className="h-2.5 w-px bg-line-strong" />}
              <button type="button" onClick={() => toast(`${l}은(는) 준비 중입니다.`)} className="text-sm font-medium text-fg-3 hover:text-fg">
                {l}
              </button>
            </Fragment>
          ))}
        </div>
        <p className="mt-2">고객 지원 : 실시간 채팅 상담</p>
        <p>© 2026 OpenSign. All rights reserved.</p>
      </div>
    </footer>
  );
}
