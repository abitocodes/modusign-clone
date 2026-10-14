"use client";

import { RotateCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ListPage, ListTitle } from "@/components/ui/list-page";

export default function SignaturesError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <ListPage>
      <ListTitle title="사인·도장" />
      <div role="alert" className="mt-5 flex h-[282px] flex-col items-center justify-center gap-4 border border-line px-4 text-center">
        <p className="text-sm leading-[1.45] text-fg-muted">
          사인·도장 목록을 불러오지 못했습니다.
          <br />
          잠시 후 다시 시도해 주세요.
        </p>
        <Button variant="neutral" icon={<RotateCw className="size-4" />} onClick={() => retry()}>
          다시 시도
        </Button>
      </div>
    </ListPage>
  );
}
