import { cn } from "@/lib/utils";

/*
 * OpenSign brand mark (original artwork).
 * An "O" split along its equator with the two halves slid apart, so the closed
 * ring opens up into a single S-shaped pen stroke: Open → Sign.
 * 64-unit grid; keep in sync with public/brand/*.svg and src/app/icon.svg.
 */
const MARK_GOLD = "#ffcb4c";
const MARK_INK = "#191919";
const MARK_STROKE = "M15 28A12 12 0 0 1 39 28M25 36A12 12 0 0 0 49 36";

function MarkArt() {
  return (
    <>
      <rect width="64" height="64" rx="14" fill={MARK_GOLD} />
      <path d={MARK_STROKE} fill="none" stroke={MARK_INK} strokeWidth="8" strokeLinecap="round" />
    </>
  );
}

/** Square OpenSign mark (gold tile). Used e.g. as the workspace avatar in the header. */
export function LogoMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={cn("shrink-0", className)}
      aria-hidden="true"
      focusable="false"
    >
      <MarkArt />
    </svg>
  );
}

/**
 * Horizontal "OpenSign" lockup: mark + wordmark ("Open" medium, "Sign" extra-bold).
 * Sized by font-size (pass e.g. `text-[26px]` / `text-sm`); everything scales in `em`.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      role="img"
      aria-label="OpenSign"
      className={cn(
        "inline-flex shrink-0 select-none items-center gap-[0.28em] whitespace-nowrap text-[15px] leading-none tracking-[-0.01em] text-fg",
        className,
      )}
    >
      <svg viewBox="0 0 64 64" className="size-[1.15em] shrink-0" aria-hidden="true" focusable="false">
        <MarkArt />
      </svg>
      <span aria-hidden="true">
        <span className="font-medium">Open</span>
        <span className="font-extrabold">Sign</span>
      </span>
    </span>
  );
}
