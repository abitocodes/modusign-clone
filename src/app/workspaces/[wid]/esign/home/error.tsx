"use client";

import { CircleAlert, RefreshCw } from "lucide-react";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";

/** Error boundary of the 홈 page. */
export default function HomeError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error("[home]", error);
  }, [error]);
  return (
    <main className="flex min-w-0 flex-1 flex-col items-center justify-center bg-body-2 px-4 py-24 text-center" role="alert">
      <CircleAlert className="size-10 text-negative" />
      <h1 className="mt-4 text-lg font-bold text-fg">홈을 불러오지 못했습니다.</h1>
      <p className="mt-2 text-sm text-fg-muted">일시적인 문제일 수 있습니다. 잠시 후 다시 시도해 주세요.</p>
      <Button variant="outline" className="mt-6" icon={<RefreshCw className="size-4" />} onClick={() => retry()}>
        다시 시도
      </Button>
    </main>
  );
}
