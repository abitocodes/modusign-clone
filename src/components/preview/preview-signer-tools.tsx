"use client";

import { CheckCheck, ExternalLink, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { viewerHref } from "@/lib/documents/view";
import { PREVIEW } from "@/lib/preview/flag";
import type { DocStatus, ParticipantStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

import { listDocumentSigners, simulatePreviewSigning } from "./actions";
import { PreviewBox, previewButtonCls } from "./preview-box";
import type { PreviewDocumentSigners } from "./types";

/** documents whose signers have nothing to open yet */
const NOT_SENT: DocStatus[] = ["draft", "on_modifying", "scheduled"];

function statusLabel(status: ParticipantStatus, view: boolean) {
  switch (status) {
    case "waiting":
      return "순서 대기";
    case "pending":
      return view ? "열람 차례" : "서명 차례";
    case "signed":
      return view ? "열람 완료" : "서명 완료";
    case "viewed":
      return "열람 완료";
    case "rejected":
      return "거절";
  }
}

/**
 * "미리보기 전용" box of a sent document (전송 완료 page, 문서함 row panel, document viewer):
 * per-participant "서명자 화면 열기" links (new tab) and "모든 서명자 서명 완료 처리 (미리보기)".
 * Renders nothing unless PREVIEW is on.
 */
export function PreviewSignerTools(props: {
  docId: string;
  /** known status: skips the lookup for documents that were not sent */
  status?: DocStatus;
  /** show "완료 문서 보기" once the document is completed (not on the viewer itself) */
  viewerLink?: boolean;
  className?: string;
}) {
  if (!PREVIEW) return null;
  if (props.status && NOT_SENT.includes(props.status)) return null;
  return <SignerTools {...props} />;
}

function SignerTools({ docId, status, viewerLink, className }: { docId: string; status?: DocStatus; viewerLink?: boolean; className?: string }) {
  const router = useRouter();
  const [data, setData] = useState<PreviewDocumentSigners | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let alive = true;
    listDocumentSigners(docId)
      .then((res) => {
        if (!alive) return;
        if (res.ok) {
          setData(res);
          setError(null);
        } else setError(res.error);
      })
      .catch(() => alive && setError("미리보기 정보를 불러오지 못했습니다."));
    return () => {
      alive = false;
    };
  }, [docId, status, version]);

  if (data && (NOT_SENT.includes(data.status) || data.signers.length === 0)) return null;

  const view = data?.requestType === "view";
  const role = view ? "열람자" : "서명자";

  const simulate = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await simulatePreviewSigning(docId);
      if (!res.ok) {
        toast.error(res.error);
      } else {
        toast.success(res.completed ? `${view ? "열람" : "서명"} 완료 처리되었습니다 (미리보기)` : `${res.signed}명의 ${view ? "열람" : "서명"}을 처리했습니다 (미리보기)`);
        router.refresh();
      }
    } catch {
      toast.error("서명 완료 처리 중 문제가 발생했습니다.");
    } finally {
      setBusy(false);
      setVersion((v) => v + 1);
    }
  };

  return (
    <PreviewBox className={className}>
      {!data ? (
        error ? (
          <p className="mt-1.5 text-[13px] text-fg-muted">{error}</p>
        ) : (
          <p className="mt-1.5 flex items-center gap-1.5 text-[13px] text-fg-muted">
            <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
            {role} 정보를 불러오는 중…
          </p>
        )
      ) : (
        <>
          <p className="mt-1.5 text-[13px] leading-relaxed text-fg-2">
            메일을 받지 않아도 {role} 화면을 열어 볼 수 있습니다.
          </p>
          <ul className="mt-2.5 flex flex-col gap-1.5">
            {data.signers.map((s) => (
              <li key={s.id} className="flex min-w-0 items-center gap-2">
                <a href={s.href} target="_blank" rel="noopener" className={cn(previewButtonCls, "min-w-0 max-w-full")}>
                  <span className="truncate">
                    {s.name} {role} 화면 열기
                  </span>
                  <ExternalLink className="size-3.5 shrink-0" aria-hidden />
                </a>
                <span className="shrink-0 text-xs text-fg-muted">{statusLabel(s.status, view)}</span>
              </li>
            ))}
          </ul>
          {data.canSimulate && (
            <button
              type="button"
              onClick={simulate}
              disabled={busy}
              className="mt-3 inline-flex h-9 w-full items-center justify-center gap-1.5 rounded border border-dashed border-warning bg-primary px-3 text-[13px] font-bold text-primary-fg shadow-button transition-colors hover:bg-primary-hover disabled:opacity-60"
            >
              {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <CheckCheck className="size-4" aria-hidden />}
              {busy ? "처리 중…" : `모든 ${role} ${view ? "열람" : "서명"} 완료 처리 (미리보기)`}
            </button>
          )}
          {viewerLink && data.status === "completed" && (
            <Link href={viewerHref(data.workspaceId, docId)} className={cn(previewButtonCls, "mt-3 w-full")}>
              완료 문서 보기
            </Link>
          )}
        </>
      )}
    </PreviewBox>
  );
}
