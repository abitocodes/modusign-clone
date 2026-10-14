"use client";

import { RefreshCw, TriangleAlert } from "lucide-react";
import { useEffect } from "react";

import { Wordmark } from "@/components/shell/logo";
import { Button } from "@/components/ui/button";

/** Public 링크서명 page: shown when the link could not be loaded. */
export default function LinkSignError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error("[link]", error);
  }, [error]);
  return (
    <div className="flex min-h-screen flex-col bg-body-2">
      <header className="flex h-[62px] shrink-0 items-center border-b border-line bg-surface px-5">
        <Wordmark />
      </header>
      <main className="flex flex-1 flex-col items-center px-4 pb-16 pt-12 sm:pt-[72px]">
        <section className="flex w-full max-w-[414px] flex-col items-center rounded-xl border border-line bg-surface px-6 py-14 text-center sm:px-[47px]">
          <span className="flex size-[62px] items-center justify-center rounded-full bg-warning-bg text-warning">
            <TriangleAlert className="size-7" />
          </span>
          <h1 className="mt-5 text-xl font-bold text-fg">링크를 불러오지 못했습니다</h1>
          <p className="mt-2 text-[13px] font-medium leading-relaxed text-fg-2">일시적인 문제일 수 있습니다. 잠시 후 다시 시도해 주세요.</p>
          <Button variant="neutral" className="mt-6" icon={<RefreshCw className="size-4" />} onClick={() => retry()}>
            다시 시도
          </Button>
        </section>
      </main>
    </div>
  );
}
