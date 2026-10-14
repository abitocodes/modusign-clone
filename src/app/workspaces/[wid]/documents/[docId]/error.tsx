"use client";

import { ArrowLeft, CircleAlert, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { documentsHome } from "@/lib/documents/view";

/** Error boundary of the read-only document viewer (full screen, outside the e-sign shell). */
export default function DocumentViewerError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const { wid } = useParams<{ wid: string }>();
  useEffect(() => {
    console.error("[document-viewer]", error);
  }, [error]);

  return (
    <div className="flex h-screen flex-col bg-body-2">
      <header className="flex h-16 shrink-0 items-center border-b border-line bg-surface pl-3 pr-4">
        <Link
          href={documentsHome(wid)}
          aria-label="문서함으로 돌아가기"
          title="문서함으로 돌아가기"
          className="flex size-10 items-center justify-center rounded-full text-fg-2 transition-colors hover:bg-btn-light"
        >
          <ArrowLeft className="size-5" />
        </Link>
      </header>
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center" role="alert">
        <CircleAlert className="size-10 text-negative" />
        <h1 className="mt-4 text-lg font-bold text-fg">문서를 표시하지 못했습니다.</h1>
        <p className="mt-2 text-sm text-fg-muted">일시적인 문제일 수 있습니다. 잠시 후 다시 시도하세요.</p>
        <Button variant="outline" className="mt-6" icon={<RefreshCw className="size-4" />} onClick={() => retry()}>
          다시 시도
        </Button>
      </div>
    </div>
  );
}
