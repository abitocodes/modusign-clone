import { LoaderCircle } from "lucide-react";

import { cn } from "@/lib/utils";

const BG = { surface: "bg-surface-2", body: "bg-body", body2: "bg-body-2" } as const;

/** Route-level loading UI of the sign-request wizard (header placeholder + spinner). */
export function WizardLoading({
  label = "불러오는 중입니다.",
  header = true,
  background = "surface",
}: {
  label?: string;
  header?: boolean;
  /** page background of the screen being loaded */
  background?: keyof typeof BG;
}) {
  return (
    <div className={cn("flex min-h-screen flex-col", BG[background])}>
      {header && <div className="h-16 shrink-0 border-b border-line bg-surface" aria-hidden />}
      <div className="flex flex-1 items-center justify-center gap-2 text-sm text-fg-muted" role="status" aria-live="polite">
        <LoaderCircle className="size-5 animate-spin" aria-hidden />
        {label}
      </div>
    </div>
  );
}
