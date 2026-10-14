"use client";

import { CircleAlert, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";

/** Route-level error UI of the sign-request wizard. */
export function WizardError({ error, retry, title }: { error: Error & { digest?: string }; retry: () => void; title: string }) {
  const params = useParams<{ wid?: string }>();
  useEffect(() => {
    console.error("[wizard]", error);
  }, [error]);
  const home = params?.wid ? `/workspaces/${params.wid}/esign/documents/documents` : "/";
  return (
    <div className="flex min-h-screen flex-col bg-surface-2">
      <div className="h-16 shrink-0 border-b border-line bg-surface" aria-hidden />
      <main className="flex flex-1 flex-col items-center justify-center px-4 text-center">
        <CircleAlert className="size-10 text-negative" aria-hidden />
        <h1 className="mt-4 text-lg font-bold text-fg">{title}</h1>
        <p className="mt-2 text-sm text-fg-muted">일시적인 문제일 수 있습니다. 잠시 후 다시 시도하세요.</p>
        <div className="mt-6 flex gap-2">
          <Button variant="outline" icon={<RefreshCw className="size-4" />} onClick={() => retry()}>
            다시 시도
          </Button>
          <Link
            href={home}
            className="inline-flex h-9 items-center rounded bg-btn-dark px-4 text-sm font-medium text-fg-2 hover:bg-btn-hover"
          >
            문서함으로
          </Link>
        </div>
      </main>
    </div>
  );
}
