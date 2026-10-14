"use client";

import { Ellipsis } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dropdown } from "@/components/ui/menu";
import { Modal } from "@/components/ui/modal";
import { cn, fmtDateTime, fmtShort } from "@/lib/utils";

const noopSubscribe = () => () => {};

/** false during SSR + hydration, true afterwards (relative dates depend on the viewer's time zone and "today"). */
export function useHydrated() {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

/** Table timestamp in the viewer's local time (오후 2:19 / 10-14 13:35 / 2025-10-14), full date-time on hover. */
export function LocalTime({ iso, className }: { iso: string | null | undefined; className?: string }) {
  const hydrated = useHydrated();
  if (!iso) return <span className={className}>-</span>;
  return (
    <time dateTime={iso} title={hydrated ? fmtDateTime(iso) : undefined} className={className}>
      {hydrated ? fmtShort(iso) : " "}
    </time>
  );
}

/** "추가 메뉴" kebab button (32×32, outlined) with a right-aligned dropdown. */
export function KebabMenu({ children, label = "추가 메뉴" }: { children: (close: () => void) => ReactNode; label?: string }) {
  return (
    <div onClick={(e) => e.stopPropagation()} className="inline-flex">
      <Dropdown
        align="right"
        panelClassName="w-44"
        trigger={(open, toggle) => (
          <button
            type="button"
            aria-label={label}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={toggle}
            className={cn(
              "flex size-8 items-center justify-center rounded-lg border border-line-strong text-icon-2 transition-colors hover:bg-btn-light",
              open && "bg-btn-light",
            )}
          >
            <Ellipsis className="size-4" />
          </button>
        )}
      >
        {(close) => children(close)}
      </Dropdown>
    </div>
  );
}

/** Small modal with a single title input (이름 변경). */
export function RenameModal({
  open,
  onClose,
  initial,
  onSubmit,
  title = "이름 변경",
  label = "제목",
  maxLength = 100,
}: {
  open: boolean;
  onClose: () => void;
  initial: string;
  onSubmit: (value: string) => Promise<boolean>;
  title?: string;
  label?: string;
  maxLength?: number;
}) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => inputRef.current?.select(), 30);
    return () => clearTimeout(t);
  }, [open]);

  const trimmed = value.trim();
  const submit = async () => {
    if (!trimmed || busy) return;
    setBusy(true);
    const ok = await onSubmit(trimmed);
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      width={480}
      footer={
        <>
          <Button variant="light" onClick={onClose}>
            취소
          </Button>
          <Button variant="primary" disabled={!trimmed || busy} onClick={submit}>
            {busy ? "변경 중…" : "변경"}
          </Button>
        </>
      }
    >
      <div className="px-[30px] pb-2 pt-6">
        <label className="mb-2 block text-sm font-medium text-fg-2" htmlFor="rename-input">
          {label}
        </label>
        <Input
          id="rename-input"
          ref={inputRef}
          value={value}
          maxLength={maxLength}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) void submit();
          }}
        />
        <p className="mt-1 text-right text-xs text-fg-muted">
          {value.length}/{maxLength}
        </p>
      </div>
    </Modal>
  );
}

/** Centered spinner + caption (loading states of the full-screen editors). */
export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-6 animate-spin rounded-full border-2 border-line-strong border-t-emphasis", className)}
    />
  );
}
