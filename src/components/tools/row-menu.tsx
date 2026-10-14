"use client";

import { MoreVertical } from "lucide-react";
import type { ReactNode } from "react";

import { Dropdown } from "@/components/ui/menu";
import { cn } from "@/lib/utils";

/**
 * 추가 메뉴 (kebab) for list rows. Clicks inside never reach the row's onClick.
 */
export function RowMenu({
  children,
  label = "추가 메뉴",
  className,
}: {
  children: (close: () => void) => ReactNode;
  label?: string;
  className?: string;
}) {
  return (
    <div className={cn("inline-flex", className)} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <Dropdown
        align="right"
        panelClassName="w-44"
        trigger={(open, toggle) => (
          <button
            type="button"
            aria-label={label}
            title={label}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={toggle}
            className={cn(
              "flex size-8 items-center justify-center rounded text-fg-faint transition-colors hover:bg-btn-light hover:text-fg-2",
              open && "bg-btn-light text-fg-2",
            )}
          >
            <MoreVertical className="size-[18px]" />
          </button>
        )}
      >
        {(close) => children(close)}
      </Dropdown>
    </div>
  );
}
