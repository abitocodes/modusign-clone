"use client";

import { LoaderCircle, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { startFromTemplate } from "./actions";

/** Starts a sign request from the template once, then replaces this page with wizard step 1. */
export function UseTemplateClient({ wid, tid }: { wid: string; tid: string }) {
  const router = useRouter();
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // guard: React strict mode mounts effects twice in development
    if (started.current) return;
    started.current = true;
    startFromTemplate(wid, tid)
      .then((res) => {
        if (res.ok) router.replace(res.href);
        else setError(res.error);
      })
      .catch(() => setError("문서를 준비하지 못했습니다. 네트워크 상태를 확인해 주세요."));
  }, [router, wid, tid]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-body-2 px-4">
      <div className="w-full max-w-[414px] rounded-xl border border-line bg-surface px-8 py-14 text-center">
        {error ? (
          <>
            <TriangleAlert className="mx-auto size-10 text-warning" strokeWidth={1.8} />
            <h1 className="mt-4 text-xl font-bold text-fg">템플릿으로 시작할 수 없습니다</h1>
            <p className="mt-2 text-[13px] font-medium leading-relaxed text-fg-2">{error}</p>
            <div className="mt-6 flex justify-center gap-2">
              <Link
                href={`/workspaces/${wid}/esign/requests/templates`}
                className="inline-flex h-10 items-center rounded-md bg-btn-dark px-4 text-sm font-medium text-fg-2 hover:bg-btn-hover"
              >
                템플릿 목록
              </Link>
              <Link
                href={`/workspaces/${wid}/documents/d/upload`}
                className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-fg hover:bg-primary-hover"
              >
                문서 업로드로 시작
              </Link>
            </div>
          </>
        ) : (
          <div role="status" aria-live="polite">
            <LoaderCircle className="mx-auto size-10 animate-spin text-fg-faint" strokeWidth={1.8} />
            <h1 className="mt-4 text-xl font-bold text-fg">문서를 준비하고 있습니다</h1>
            <p className="mt-2 text-[13px] font-medium text-fg-2">템플릿의 문서와 입력란을 불러오는 중입니다. 잠시만 기다려 주세요.</p>
          </div>
        )}
      </div>
    </div>
  );
}
