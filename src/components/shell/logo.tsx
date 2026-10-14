import { cn } from "@/lib/utils";

/** Square workspace mark (original artwork — a simple "M" monogram). */
export function LogoMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="6" fill="#3a4250" />
      <path d="M8 23V9.5h2.6l5.4 7.2 5.4-7.2H24V23h-2.8v-8.6L16 21.2l-5.2-6.8V23H8z" fill="#fff" />
    </svg>
  );
}

/** Text wordmark "OpenSign". */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("select-none text-[15px] font-extrabold tracking-[-0.02em] text-fg", className)}>
      Open<span className="text-warning">Sign</span>
    </span>
  );
}
