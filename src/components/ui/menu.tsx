"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Click-to-open dropdown. `trigger` receives `open` so it can render an active state.
 * Closes on outside click / Escape / item click.
 */
export function Dropdown({
  trigger,
  children,
  align = "left",
  className,
  panelClassName,
  offset = 6,
}: {
  trigger: (open: boolean, toggle: () => void) => ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  align?: "left" | "right";
  className?: string;
  panelClassName?: string;
  offset?: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <div ref={ref} className={cn("relative inline-flex", className)}>
      {trigger(open, () => setOpen((o) => !o))}
      {open && (
        <div
          role="menu"
          className={cn(
            "absolute top-full z-50 min-w-[160px] overflow-hidden rounded-lg border border-line-strong bg-menu py-1.5 shadow-menu",
            align === "right" ? "right-0" : "left-0",
            panelClassName,
          )}
          style={{ marginTop: offset }}
        >
          {typeof children === "function" ? children(close) : children}
        </div>
      )}
    </div>
  );
}

export function MenuItem({
  icon,
  children,
  onClick,
  danger,
  disabled,
  className,
  caption,
}: {
  icon?: ReactNode;
  children: ReactNode;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
  className?: string;
  caption?: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 px-4 py-2 text-left text-[13px] font-medium text-fg hover:bg-menu-hover disabled:opacity-40",
        danger && "text-negative",
        className,
      )}
    >
      {icon && <span className="flex w-4 justify-center text-fg-3 [&_svg]:size-[15px]">{icon}</span>}
      <span className="flex-1">
        {children}
        {caption && <span className="mt-0.5 block text-[11px] font-normal text-fg-muted">{caption}</span>}
      </span>
    </button>
  );
}

export function MenuDivider() {
  return <div className="my-1.5 h-px bg-line-strong" />;
}

/**
 * Select-like dropdown (라벨 미선택 ▼ / 모든 공유 문서 ▼ …)
 */
export function SelectMenu<T extends string>({
  value,
  options,
  onChange,
  width = 180,
  className,
  placeholder,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  width?: number;
  className?: string;
  placeholder?: string;
}) {
  const current = options.find((o) => o.value === value);
  return (
    <Dropdown
      className={className}
      panelClassName="w-full"
      trigger={(open, toggle) => (
        <button
          type="button"
          onClick={toggle}
          style={{ width }}
          className={cn(
            "flex h-9 items-center justify-between rounded bg-surface px-3 text-sm text-fg shadow-input",
            open && "outline outline-1 outline-emphasis",
          )}
        >
          <span className="truncate">{current?.label ?? placeholder}</span>
          <svg width="10" height="6" viewBox="0 0 10 6" className="ml-2 shrink-0 fill-icon-2">
            <path d="M0 0h10L5 6z" />
          </svg>
        </button>
      )}
    >
      {(close) =>
        options.map((o) => (
          <MenuItem
            key={o.value}
            onClick={() => {
              onChange(o.value);
              close();
            }}
            className={cn(o.value === value && "bg-menu-hover")}
          >
            {o.label}
          </MenuItem>
        ))
      }
    </Dropdown>
  );
}
