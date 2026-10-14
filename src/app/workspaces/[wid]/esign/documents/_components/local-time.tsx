"use client";

import { useSyncExternalStore } from "react";

import { fmtSeconds } from "@/lib/documents/view";
import { fmtDashDateTime, fmtDate, fmtShort } from "@/lib/utils";

const subscribe = () => () => {};

/** false during SSR + hydration, true afterwards (dates depend on the viewer's time zone / "today"). */
export function useHydrated() {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}

const FORMATS = {
  short: fmtShort,
  dash: fmtDashDateTime,
  seconds: fmtSeconds,
  date: fmtDate,
} as const;

/** Renders a timestamp in the viewer's local time ("사용자 컴퓨터 시간 기준"). */
export function LocalTime({
  iso,
  variant = "short",
  className,
  empty = "-",
}: {
  iso: string | null | undefined;
  variant?: keyof typeof FORMATS;
  className?: string;
  empty?: string;
}) {
  const hydrated = useHydrated();
  if (!iso) return <span className={className}>{empty}</span>;
  return (
    <time dateTime={iso} className={className}>
      {hydrated ? FORMATS[variant](iso) : " "}
    </time>
  );
}
