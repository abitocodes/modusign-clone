"use client";

import { TriangleAlert } from "lucide-react";
import { useEffect } from "react";

export default function SignError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-dvh flex-col bg-body-2">
      <div className="h-[62px] shrink-0 border-b border-line bg-surface" />
      <main className="flex flex-1 flex-col items-center px-4 pt-3">
        <section className="flex w-full max-w-[414px] flex-col items-center rounded-xl border border-line bg-surface px-6 py-14 text-center">
          <span className="flex size-[62px] items-center justify-center rounded-full bg-negative-bg text-negative" aria-hidden>
            <TriangleAlert className="size-7" />
          </span>
          <h1 className="mt-5 text-xl font-bold text-fg">문서를 표시하지 못했습니다.</h1>
          <p className="mt-2 text-[13px] font-medium text-fg-2">일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.</p>
          <button
            type="button"
            onClick={reset}
            className="mt-8 h-10 rounded bg-primary px-[22px] text-sm font-bold text-primary-fg shadow-button hover:bg-primary-hover"
          >
            다시 시도
          </button>
        </section>
      </main>
    </div>
  );
}
