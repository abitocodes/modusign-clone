"use client";

import { CircleAlert, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";

/** Error UI of the full-screen template routes (등록 / 수정 / 사용하기). */
export default function TemplateRouteError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const params = useParams<{ wid?: string }>();
  useEffect(() => {
    console.error("[templates]", error);
  }, [error]);
  const list = params?.wid ? `/workspaces/${params.wid}/esign/requests/templates` : "/";
  return (
    <div className="flex min-h-screen flex-col bg-body">
      <div className="h-16 shrink-0 border-b border-line bg-surface" aria-hidden />
      <main className="flex flex-1 flex-col items-center justify-center px-4 text-center">
        <CircleAlert className="size-10 text-negative" aria-hidden />
        <h1 className="mt-4 text-lg font-bold text-fg">템플릿 화면을 불러오지 못했습니다.</h1>
        <p className="mt-2 text-sm text-fg-muted">일시적인 문제일 수 있습니다. 잠시 후 다시 시도하세요.</p>
        <div className="mt-6 flex gap-2">
          <Button variant="outline" icon={<RefreshCw className="size-4" />} onClick={() => retry()}>
            다시 시도
          </Button>
          <Link href={list} className="inline-flex h-9 items-center rounded bg-btn-dark px-4 text-sm font-medium text-fg-2 hover:bg-btn-hover">
            템플릿 목록으로
          </Link>
        </div>
      </main>
    </div>
  );
}
