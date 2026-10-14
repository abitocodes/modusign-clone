"use client";

import { ExternalLink, FlaskConical, Inbox, LoaderCircle, RefreshCw, RotateCcw, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";

import { ConfirmModal } from "@/components/ui/modal";
import { PREVIEW } from "@/lib/preview/flag";
import { cn } from "@/lib/utils";

import { listPendingSigners, resetPreviewData } from "./actions";
import { previewButtonCls } from "./preview-box";
import type { PreviewPendingList } from "./types";

/**
 * Floating "미리보기 모드" pill (bottom-left; top-left on phones; every page) with a popover: what the mode is, the
 * outbound mail log, 데모 데이터 초기화 and the signer links of documents waiting for signatures.
 * Mounted by the root layout; renders nothing unless PREVIEW is on.
 */
export function PreviewBadge() {
  if (!PREVIEW) return null;
  return <Badge />;
}

function Badge() {
  const router = useRouter();
  const popoverId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [list, setList] = useState<PreviewPendingList | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      setList(await listPendingSigners());
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const toggle = () => {
    if (!open) void load();
    setOpen(!open);
  };

  // outside click / Escape closes the popover (not while the reset confirmation is showing)
  useEffect(() => {
    if (!open || confirmReset) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, confirmReset]);

  const reset = async () => {
    if (resetting) return;
    setResetting(true);
    try {
      const res = await resetPreviewData();
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("데모 데이터를 초기화했습니다.");
      setOpen(false);
      setList(null);
      router.push("/");
      router.refresh();
    } catch {
      toast.error("데모 데이터를 초기화하지 못했습니다.");
    } finally {
      setResetting(false);
    }
  };

  if (hidden) return null;

  return (
    // phones: top-left (the signer pages' header is empty there, their 나가기 / 다음으로 bar is at the
    // bottom); wider screens: bottom-left, right of the Next.js dev indicator (bottom-left, ~56px)
    <div ref={rootRef} className="fixed left-3 top-3 z-[90] sm:bottom-[18px] sm:left-[68px] sm:top-auto">
      {open && (
        <div
          id={popoverId}
          role="dialog"
          aria-label="미리보기 모드"
          className="absolute left-0 top-full mt-2 flex max-h-[min(560px,calc(100dvh-80px))] w-[340px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-xl border border-dashed border-warning/70 bg-modal shadow-modal sm:bottom-full sm:top-auto sm:mb-2 sm:mt-0"
        >
          <div className="flex items-start gap-2 border-b border-line px-4 pb-3 pt-3.5">
            <FlaskConical className="mt-0.5 size-4 shrink-0 text-warning" strokeWidth={2.2} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-fg">미리보기 모드</p>
              <p className="mt-1 text-[13px] leading-relaxed text-fg-2">
                백엔드 없이 동작하는 미리보기입니다. 메일은 실제로 발송되지 않습니다.
              </p>
            </div>
            <button
              type="button"
              aria-label="닫기"
              onClick={() => setOpen(false)}
              className="-mr-1 flex size-7 shrink-0 items-center justify-center rounded-full text-fg-muted hover:bg-btn-light hover:text-fg"
            >
              <X className="size-4" />
            </button>
          </div>

          <div className="flex flex-wrap gap-2 px-4 py-3">
            <Link href="/dev/mailbox" onClick={() => setOpen(false)} className={previewButtonCls}>
              <Inbox className="size-3.5" aria-hidden />
              보낸 메일함 보기
            </Link>
            <button type="button" onClick={() => setConfirmReset(true)} disabled={resetting} className={previewButtonCls}>
              {resetting ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> : <RotateCcw className="size-3.5" aria-hidden />}
              데모 데이터 초기화
            </button>
          </div>

          <section className="min-h-0 flex-1 overflow-y-auto border-t border-line px-4 pb-4 pt-3" aria-label="서명 대기 문서">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-[13px] font-bold text-fg">서명을 기다리는 문서</h3>
              <button
                type="button"
                aria-label="새로고침"
                title="새로고침"
                onClick={() => void load()}
                disabled={loading}
                className="flex size-7 items-center justify-center rounded-full text-fg-muted hover:bg-btn-light hover:text-fg disabled:opacity-50"
              >
                <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
              </button>
            </div>
            <PendingList list={list} loading={loading} error={loadError} onNavigate={() => setOpen(false)} />
          </section>

          <div className="border-t border-line px-4 py-2 text-right">
            <button type="button" onClick={() => setHidden(true)} className="text-xs text-fg-muted underline-offset-2 hover:text-fg hover:underline">
              배지 숨기기 (새로고침하면 다시 표시)
            </button>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        className="flex h-8 items-center gap-1.5 rounded-full border border-dashed border-warning bg-warning-bg px-3 text-xs font-bold text-warning shadow-menu transition-[filter] hover:brightness-125"
      >
        <FlaskConical className="size-3.5" strokeWidth={2.2} aria-hidden />
        미리보기 모드
      </button>

      <ConfirmModal
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        onConfirm={() => void reset()}
        title="데모 데이터를 초기화할까요?"
        description="미리보기에서 만든 문서·서명·메일 기록이 모두 지워지고 처음 상태의 데모 데이터로 돌아갑니다."
        confirmLabel="초기화"
        danger
      />
    </div>
  );
}

function PendingList({
  list,
  loading,
  error,
  onNavigate,
}: {
  list: PreviewPendingList | null;
  loading: boolean;
  error: boolean;
  onNavigate: () => void;
}) {
  if (error) return <p className="mt-2 text-[13px] text-negative">목록을 불러오지 못했습니다.</p>;
  if (!list) {
    return (
      <p className="mt-2 flex items-center gap-1.5 text-[13px] text-fg-muted">
        <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
        불러오는 중…
      </p>
    );
  }
  if (!list.signedIn) return <p className="mt-2 text-[13px] text-fg-muted">로그인하면 서명 대기 중인 문서가 표시됩니다.</p>;
  if (!list.docs.length) {
    return <p className={cn("mt-2 text-[13px] text-fg-muted", loading && "opacity-60")}>서명을 기다리는 문서가 없습니다.</p>;
  }
  return (
    <ul className={cn("mt-2 flex flex-col gap-3", loading && "opacity-60")}>
      {list.docs.map((d) => (
        <li key={d.id} className="min-w-0">
          <Link
            href={`/workspaces/${d.workspaceId}/documents/${d.id}`}
            onClick={onNavigate}
            className="block truncate text-[13px] font-semibold text-fg-2 hover:text-fg hover:underline"
            title={d.title}
          >
            {d.title}
          </Link>
          <ul className="mt-1.5 flex flex-col gap-1">
            {d.signers.map((s) => (
              <li key={s.id} className="flex min-w-0 items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-xs text-fg-muted" title={s.email ?? undefined}>
                  {s.name}
                </span>
                <a href={s.href} target="_blank" rel="noopener" className={cn(previewButtonCls, "h-7 px-2.5 text-xs")}>
                  {d.requestType === "view" ? "열람자" : "서명자"} 화면 열기
                  <ExternalLink className="size-3" aria-hidden />
                </a>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
