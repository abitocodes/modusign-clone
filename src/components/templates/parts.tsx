"use client";

import { CircleHelp, FileText, Tag } from "lucide-react";
import type { ReactNode } from "react";

import { PdfPageView, usePdfDocument } from "@/components/pdf/pdf";
import { Chip } from "@/components/ui/badge";
import type { Label, RequestType } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Column header / section title with a (?) tooltip. */
export function HelpLabel({ label, tip, className, iconClassName }: { label: ReactNode; tip: string; className?: string; iconClassName?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)}>
      {label}
      <span title={tip} aria-label={tip} role="img" className="inline-flex cursor-help">
        <CircleHelp className={cn("size-3.5", iconClassName)} strokeWidth={2} />
      </span>
    </span>
  );
}

/** 서명 / 열람 chip */
export function RequestTypeChip({ type, className }: { type: RequestType; className?: string }) {
  return type === "view" ? (
    <Chip tone="emphasis" className={className}>
      열람
    </Chip>
  ) : (
    <Chip className={className}>서명</Chip>
  );
}

/** Label chips (same look as the 문서함 list). */
export function LabelChips({
  ids,
  labels,
  max = 2,
  empty = "라벨 없음",
  emptyIcon = true,
}: {
  ids: string[];
  labels: Label[];
  max?: number;
  empty?: ReactNode;
  /** show the tag icon next to the empty text (off for "-" in table cells) */
  emptyIcon?: boolean;
}) {
  const list = ids.map((id) => labels.find((l) => l.id === id)).filter((l): l is Label => !!l);
  if (list.length === 0) {
    return empty === null ? null : (
      <span className="flex items-center gap-1.5 text-[13px] text-fg-muted">
        {emptyIcon && <Tag className="size-3.5" />}
        {empty}
      </span>
    );
  }
  return (
    <div className="flex flex-wrap gap-1">
      {list.slice(0, max).map((l) => (
        <span key={l.id} className="inline-flex h-[22px] max-w-[120px] items-center gap-1 rounded border border-line-strong px-1.5 text-xs text-fg-2">
          <span className="size-2 shrink-0 rounded-full" style={{ background: l.color }} aria-hidden />
          <span className="truncate">{l.name}</span>
        </span>
      ))}
      {list.length > max && (
        <span
          className="inline-flex h-[22px] items-center rounded border border-line-strong px-1.5 text-xs text-fg-muted"
          title={list
            .slice(max)
            .map((l) => l.name)
            .join(", ")}
        >
          +{list.length - max}
        </span>
      )}
    </div>
  );
}

/** Copies text to the clipboard (falls back to execCommand on insecure origins). */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/** First page of a PDF (signed URL) as a white thumbnail; generic page icon while unavailable. */
export function PdfFirstPage({ url, width, className }: { url: string | null; width: number; className?: string }) {
  const { doc, error, loading } = usePdfDocument(url);
  return (
    <div className={cn("relative overflow-hidden bg-page", className)} style={{ width }}>
      {!url || error ? (
        <div className="flex aspect-[1/1.414] w-full items-center justify-center">
          <FileText className="size-1/3 text-fg-disabled" strokeWidth={1.4} />
        </div>
      ) : loading || !doc ? (
        <div className="aspect-[1/1.414] w-full animate-pulse bg-page" />
      ) : (
        <PdfPageView doc={doc} pageNumber={1} width={width} className="shadow-none" />
      )}
    </div>
  );
}
