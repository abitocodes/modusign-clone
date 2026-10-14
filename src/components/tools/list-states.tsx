"use client";

import { Loader, RotateCw, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { ListPage, ListTitle } from "@/components/ui/list-page";
import { cn } from "@/lib/utils";

/** Spinner block used while a list is loading (matches the 내부결재 loading capture). */
export function Spinner({ className, label = "불러오는 중" }: { className?: string; label?: string }) {
  return (
    <span role="status" aria-label={label} className={cn("inline-flex text-fg-faint", className)}>
      <Loader className="size-9 animate-spin [animation-duration:1.4s]" strokeWidth={1.6} />
    </span>
  );
}

/** loading.tsx body for the list pages of this area. */
export function ListLoading({ title, filter = true }: { title: ReactNode; filter?: boolean }) {
  return (
    <ListPage>
      <ListTitle title={title} />
      {filter && <div className="mt-5 h-[62px] rounded-lg border border-line-strong bg-surface-3" />}
      <div className="mt-[18px] h-[50px] border-b border-line" />
      <div className="flex min-h-[230px] items-center justify-center border-b border-line-light">
        <Spinner />
      </div>
    </ListPage>
  );
}

/** error.tsx body for the pages of this area. */
export function ErrorState({
  title = "페이지를 불러오지 못했습니다.",
  description = "잠시 후 다시 시도해 주세요. 문제가 계속되면 관리자에게 문의해 주세요.",
  onRetry,
  className,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div className={cn("flex min-h-[320px] flex-col items-center justify-center gap-3 px-6 text-center", className)}>
      <TriangleAlert className="size-9 text-warning" strokeWidth={1.8} />
      <p className="text-base font-medium text-fg">{title}</p>
      <p className="max-w-md text-sm text-fg-muted">{description}</p>
      {onRetry && (
        <Button variant="neutral" className="mt-2" icon={<RotateCw className="size-4" />} onClick={onRetry}>
          다시 시도
        </Button>
      )}
    </div>
  );
}
