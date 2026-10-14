"use client";

import { CircleAlert, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useEffect, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { ListPage, ListTitle } from "@/components/ui/list-page";

import { EditorFrame } from "./editor-frame";
import { Spinner } from "./list-ui";

/**
 * loading.tsx / error.tsx bodies of the 문서 편집기 · 서식 작성기 routes
 * (list pages inside the 서명 요청 shell, full-screen editors on top of it).
 */

/** List skeleton: title row, filter bar, table header and a spinner where the rows go. */
export function ListLoadingView({ title }: { title: ReactNode }) {
  return (
    <ListPage>
      <div aria-busy="true" aria-live="polite">
        <ListTitle title={title} />
        <div className="mt-5 h-[62px] rounded-lg border border-line-strong bg-surface-3" />
        <div className="mt-[18px] h-[50px] border-b border-line" />
        <div className="flex min-h-[230px] flex-col items-center justify-center gap-3 border-b border-line-light text-sm text-fg-muted">
          <Spinner />
          목록을 불러오는 중…
        </div>
      </div>
    </ListPage>
  );
}

/** Full-screen editor placeholder (top bar + toolbar strip + spinner). */
export function EditorLoadingView({ message }: { message: string }) {
  return (
    <EditorFrame>
      <div className="h-16 shrink-0 border-b border-line bg-surface" />
      <div className="h-12 shrink-0 border-b border-line bg-menu" />
      <div role="status" aria-live="polite" className="flex flex-1 flex-col items-center justify-center gap-3 text-sm text-fg-muted">
        <Spinner />
        {message}
      </div>
    </EditorFrame>
  );
}

function ErrorBody({ title, error, retry, backHref }: { title: string; error: Error & { digest?: string }; retry: () => void; backHref?: string }) {
  useEffect(() => {
    console.error("[editing]", error);
  }, [error]);
  return (
    <div role="alert" className="flex min-h-[320px] flex-1 flex-col items-center justify-center px-6 text-center">
      <CircleAlert className="size-10 text-negative" />
      <h1 className="mt-4 text-lg font-bold text-fg">{title}</h1>
      <p className="mt-2 text-sm text-fg-muted">일시적인 문제일 수 있습니다. 잠시 후 다시 시도해 주세요.</p>
      <div className="mt-6 flex gap-2">
        {backHref && (
          <Link
            href={backHref}
            className="inline-flex h-9 items-center rounded bg-btn-light px-3.5 text-sm font-medium text-fg-2 shadow-button hover:bg-btn-base"
          >
            목록으로
          </Link>
        )}
        <Button variant="outline" icon={<RefreshCw className="size-4" />} onClick={() => retry()}>
          다시 시도
        </Button>
      </div>
    </div>
  );
}

/** error.tsx body of a list page. */
export function ListErrorView(props: { title: string; heading: string; error: Error & { digest?: string }; retry: () => void }) {
  return (
    <ListPage>
      <ListTitle title={props.heading} />
      <ErrorBody title={props.title} error={props.error} retry={props.retry} />
    </ListPage>
  );
}

/** error.tsx body of a full-screen editor. */
export function EditorErrorView(props: { title: string; backHref: string; error: Error & { digest?: string }; retry: () => void }) {
  return (
    <EditorFrame>
      <ErrorBody title={props.title} error={props.error} retry={props.retry} backHref={props.backHref} />
    </EditorFrame>
  );
}
