"use client";

import { WandSparkles } from "lucide-react";

import { PREVIEW } from "@/lib/preview/flag";
import { cn } from "@/lib/utils";

/**
 * Floating "자동 입력 (미리보기)" button of the signer page in signing mode: the page fills every one
 * of the signer's fields with dummy values (see ./dummy-values). Renders nothing unless PREVIEW is on.
 */
export function PreviewAutoFillButton({ onFill, className }: { onFill: () => void; className?: string }) {
  if (!PREVIEW) return null;
  return (
    <button
      type="button"
      onClick={onFill}
      title="미리보기 전용: 내 입력란을 모두 임의의 값으로 채웁니다."
      className={cn(
        "fixed right-4 top-[76px] z-40 flex h-9 items-center gap-1.5 rounded-full border border-dashed border-warning bg-warning-bg px-3.5 text-[13px] font-bold text-warning shadow-menu transition-[filter] hover:brightness-125",
        className,
      )}
    >
      <WandSparkles className="size-4" aria-hidden />
      자동 입력 (미리보기)
    </button>
  );
}
