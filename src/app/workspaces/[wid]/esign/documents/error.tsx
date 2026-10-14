"use client";

import { CircleAlert, RefreshCw } from "lucide-react";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { ListPage } from "@/components/ui/list-page";

/** Error boundary of the 문서함 section (list, data export, reminders). */
export default function DocumentsError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error("[documents]", error);
  }, [error]);
  return (
    <ListPage className="flex flex-col items-center justify-center text-center">
      <CircleAlert className="size-10 text-negative" />
      <h1 className="mt-4 text-lg font-bold text-fg">문서함을 불러오지 못했습니다.</h1>
      <p className="mt-2 text-sm text-fg-muted">일시적인 문제일 수 있습니다. 잠시 후 다시 시도하세요.</p>
      <Button variant="outline" className="mt-6" icon={<RefreshCw className="size-4" />} onClick={() => retry()}>
        다시 시도
      </Button>
    </ListPage>
  );
}
