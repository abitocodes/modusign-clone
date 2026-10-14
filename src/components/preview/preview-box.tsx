import { FlaskConical } from "lucide-react";
import type { ReactNode } from "react";

import { PREVIEW } from "@/lib/preview/flag";
import { cn } from "@/lib/utils";

/**
 * Frame of every preview-only widget: dashed warning border + "미리보기 전용" label, so it is obviously
 * not part of the product. Renders nothing unless PREVIEW is on.
 */
export function PreviewBox({
  title = "미리보기 전용",
  children,
  className,
}: {
  title?: string;
  children?: ReactNode;
  className?: string;
}) {
  if (!PREVIEW) return null;
  return (
    <div
      role="note"
      aria-label={title}
      className={cn("rounded-lg border border-dashed border-warning/70 bg-warning-bg px-3.5 py-3 text-left", className)}
    >
      <p className="flex items-center gap-1.5 text-xs font-bold text-warning">
        <FlaskConical className="size-3.5 shrink-0" strokeWidth={2.2} aria-hidden />
        {title}
      </p>
      {children}
    </div>
  );
}

/** Small button in the preview look (dashed warning outline). */
export const previewButtonCls =
  "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded border border-dashed border-warning/70 bg-surface px-3 text-[13px] font-semibold text-warning transition-colors hover:bg-btn-light disabled:cursor-default disabled:opacity-60";
