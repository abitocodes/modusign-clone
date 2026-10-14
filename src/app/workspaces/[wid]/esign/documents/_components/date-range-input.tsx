"use client";

import { CalendarDays } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dropdown } from "@/components/ui/menu";
import { formatDateRangeText, parseDateRangeText } from "@/lib/documents/view";
import { cn } from "@/lib/utils";

/**
 * "YY.MM.DD ~ YY.MM.DD" text input with a calendar popover (two native date pickers).
 * Calls `onApply(from, to)` with ISO days (YYYY-MM-DD) or nulls; invalid text → toast.
 */
export function DateRangeInput({
  from,
  to,
  onApply,
  width = 240,
  className,
  inputClassName,
  ariaLabel = "기간",
}: {
  from: string | null;
  to: string | null;
  onApply: (from: string | null, to: string | null) => void;
  width?: number;
  className?: string;
  inputClassName?: string;
  ariaLabel?: string;
}) {
  const [text, setText] = useState(() => formatDateRangeText(from, to));
  const lastAttempt = useRef(text);
  const [pickFrom, setPickFrom] = useState(from ?? "");
  const [pickTo, setPickTo] = useState(to ?? "");

  const commit = (force = false) => {
    if (!force && text === lastAttempt.current) return;
    lastAttempt.current = text;
    const r = parseDateRangeText(text);
    if (r === "invalid") {
      toast.error("날짜를 올바르게 입력하세요.", { description: "예) 26.10.01 ~ 26.10.14" });
      return;
    }
    const normalized = formatDateRangeText(r.from, r.to);
    setText(normalized);
    lastAttempt.current = normalized;
    if (r.from !== from || r.to !== to) onApply(r.from, r.to);
  };

  const applyPicked = (close: () => void) => {
    const a = pickFrom || null;
    const b = pickTo || null;
    if (a && b && a > b) {
      toast.error("시작일이 종료일보다 늦습니다.");
      return;
    }
    const normalized = formatDateRangeText(a, b);
    setText(normalized);
    lastAttempt.current = normalized;
    close();
    if (a !== from || b !== to) onApply(a, b);
  };

  return (
    <div className={cn("relative", className)} style={{ width }}>
      <Input
        aria-label={ariaLabel}
        value={text}
        placeholder="YY.MM.DD ~ YY.MM.DD"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit(true);
        }}
        onBlur={() => commit()}
        className={inputClassName}
        right={
          <Dropdown
            align="right"
            panelClassName="w-[272px] p-3"
            trigger={(open, toggle) => (
              <button
                type="button"
                aria-label="달력에서 기간 선택"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  if (!open) {
                    const r = parseDateRangeText(text);
                    setPickFrom(r === "invalid" ? (from ?? "") : (r.from ?? ""));
                    setPickTo(r === "invalid" ? (to ?? "") : (r.to ?? ""));
                  }
                  toggle();
                }}
                className={cn("flex h-8 w-9 items-center justify-center text-fg-faint hover:text-fg", open && "text-emphasis")}
              >
                <CalendarDays className="size-4" />
              </button>
            )}
          >
            {(close) => (
              <div className="space-y-2.5" role="group" aria-label="기간 선택">
                <label className="block">
                  <span className="mb-1 block text-xs text-fg-muted">시작일</span>
                  <input
                    type="date"
                    value={pickFrom}
                    max={pickTo || undefined}
                    onChange={(e) => setPickFrom(e.target.value)}
                    className="h-9 w-full rounded border border-line bg-surface px-2 text-sm text-fg outline-none focus:border-emphasis"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-fg-muted">종료일</span>
                  <input
                    type="date"
                    value={pickTo}
                    min={pickFrom || undefined}
                    onChange={(e) => setPickTo(e.target.value)}
                    className="h-9 w-full rounded border border-line bg-surface px-2 text-sm text-fg outline-none focus:border-emphasis"
                  />
                </label>
                <div className="flex justify-end gap-1.5 pt-1">
                  <Button
                    size="sm"
                    variant="light"
                    onClick={() => {
                      setPickFrom("");
                      setPickTo("");
                    }}
                  >
                    초기화
                  </Button>
                  <Button size="sm" variant="primary" onClick={() => applyPicked(close)}>
                    적용
                  </Button>
                </div>
              </div>
            )}
          </Dropdown>
        }
      />
    </div>
  );
}
