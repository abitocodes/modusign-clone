"use client";

import { CircleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function SettingsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section className="mb-3 rounded-xl border border-line bg-surface p-[30px]">
      <div className="flex flex-col items-center py-12 text-center">
        <CircleAlert className="size-9 text-negative" />
        <p className="mt-4 text-base font-bold text-fg">설정 정보를 불러오지 못했습니다.</p>
        <p className="mt-1.5 text-[13px] text-fg-muted">잠시 후 다시 시도해 주세요.{error.digest ? ` (오류 코드: ${error.digest})` : ""}</p>
        <Button variant="outline" size="md" className="mt-6" onClick={reset}>
          다시 시도
        </Button>
      </div>
    </section>
  );
}
