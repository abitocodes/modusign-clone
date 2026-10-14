"use client";

import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Shared layout pieces for the list pages of the 서명 요청 / 문서함 sections:
 * title row (h1 + chips + actions), filter bar, table, empty state and pagination.
 */
export function ListPage({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("min-h-full bg-surface px-9 pb-16 pt-[30px]", className)}>{children}</div>;
}

export function ListTitle({ title, chips, actions }: { title: ReactNode; chips?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex min-h-9 items-center justify-between gap-4">
      <div className="flex items-center gap-2">
        <h1 className="text-xl font-medium text-fg">{title}</h1>
        {chips && <div className="ml-0.5 flex items-center gap-2">{chips}</div>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function FilterBar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("mt-5 flex flex-wrap items-center gap-2 rounded-lg border border-line-strong bg-surface-3 p-3", className)}>
      {children}
    </div>
  );
}

export interface Column {
  key: string;
  label: ReactNode;
  width?: number | string;
  sortable?: boolean;
  align?: "left" | "right" | "center";
  className?: string;
}

export function TableHeader({
  columns,
  sort,
  onSort,
  leading,
  className,
}: {
  columns: Column[];
  sort?: { key: string; dir: "asc" | "desc" };
  onSort?: (key: string) => void;
  leading?: ReactNode;
  className?: string;
}) {
  return (
    <div role="row" className={cn("mt-[18px] flex h-[50px] items-center border-b border-line px-3 text-[13px] text-fg-faint", className)}>
      {leading && <div className="mr-4 flex w-4 shrink-0 items-center">{leading}</div>}
      {columns.map((c) => (
        <div
          key={c.key}
          role="columnheader"
          className={cn("flex shrink-0 items-center px-3 first:pl-0", c.align === "right" && "justify-end", c.align === "center" && "justify-center", c.className)}
          style={{ width: c.width, flex: c.width ? undefined : 1 }}
        >
          {c.sortable ? (
            <button type="button" onClick={() => onSort?.(c.key)} className="flex items-center gap-1 hover:text-fg-2">
              {c.label}
              {sort?.key === c.key &&
                (sort.dir === "desc" ? <ArrowDown className="size-3.5" /> : <ArrowUp className="size-3.5" />)}
            </button>
          ) : (
            c.label
          )}
        </div>
      ))}
    </div>
  );
}

export function TableRow({
  children,
  onClick,
  className,
  leading,
}: {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
  leading?: ReactNode;
}) {
  return (
    <div
      role="row"
      onClick={onClick}
      className={cn("flex min-h-14 items-center border-b border-line px-3 text-sm transition-colors hover:bg-surface-3", onClick && "cursor-pointer", className)}
    >
      {leading && (
        <div className="mr-4 flex w-4 shrink-0 items-center" onClick={(e) => e.stopPropagation()}>
          {leading}
        </div>
      )}
      {children}
    </div>
  );
}

export function Cell({ width, children, className, align }: { width?: number | string; children?: ReactNode; className?: string; align?: "left" | "right" | "center" }) {
  return (
    <div
      role="cell"
      className={cn("min-w-0 shrink-0 px-3 first:pl-0", align === "right" && "text-right", align === "center" && "text-center", className)}
      style={{ width, flex: width ? undefined : 1 }}
    >
      {children}
    </div>
  );
}

export function EmptyRows({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-h-[230px] flex-col items-center justify-center border-b border-line-light text-center text-sm leading-relaxed text-fg-muted", className)}>
      {children}
    </div>
  );
}

export function Pagination({
  page,
  pageCount,
  onChange,
  pageSize,
  onPageSizeChange,
}: {
  page: number;
  pageCount: number;
  onChange: (p: number) => void;
  pageSize?: number;
  onPageSizeChange?: (n: number) => void;
}) {
  const pages = Math.max(1, pageCount);
  const start = Math.floor((page - 1) / 10) * 10 + 1;
  const nums = Array.from({ length: Math.min(10, pages - start + 1) }, (_, i) => start + i);
  const btn = "flex h-9 w-[47px] items-center justify-center text-fg-disabled hover:text-fg-2 disabled:opacity-40 disabled:hover:text-fg-disabled";
  return (
    <div className="relative mt-[30px]">
      {onPageSizeChange && (
        <div className="mb-5 flex justify-end">
          <PageSizeSelect value={pageSize ?? 10} onChange={onPageSizeChange} />
        </div>
      )}
      <div className="flex items-center justify-center gap-0.5">
        <button type="button" aria-label="처음" className={btn} disabled={page <= 1} onClick={() => onChange(1)}>
          <ChevronsLeft className="size-4" />
        </button>
        <button type="button" aria-label="이전" className={btn} disabled={page <= 1} onClick={() => onChange(page - 1)}>
          <ChevronLeft className="size-4" />
        </button>
        {nums.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className={cn(
              "h-9 min-w-10 rounded px-2 text-sm font-medium",
              n === page ? "bg-btn-base text-fg-muted" : "text-fg-disabled hover:text-fg-2",
            )}
          >
            {n}
          </button>
        ))}
        <button type="button" aria-label="다음" className={btn} disabled={page >= pages} onClick={() => onChange(page + 1)}>
          <ChevronRight className="size-4" />
        </button>
        <button type="button" aria-label="마지막" className={btn} disabled={page >= pages} onClick={() => onChange(pages)}>
          <ChevronsRight className="size-4" />
        </button>
      </div>
    </div>
  );
}

export const PAGE_SIZES = [10, 20, 35, 50, 100];

export function PageSizeSelect({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="relative inline-flex">
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-9 w-[130px] appearance-none rounded bg-surface pl-3 pr-8 text-sm text-fg shadow-input outline-none"
      >
        {PAGE_SIZES.map((n) => (
          <option key={n} value={n}>
            {n}개씩 보기
          </option>
        ))}
      </select>
      <svg width="10" height="6" viewBox="0 0 10 6" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 fill-icon-2">
        <path d="M0 0h10L5 6z" />
      </svg>
    </div>
  );
}

/** client-side pagination helper */
export function paginate<T>(rows: T[], page: number, size: number) {
  const pageCount = Math.max(1, Math.ceil(rows.length / size));
  const p = Math.min(Math.max(1, page), pageCount);
  return { pageRows: rows.slice((p - 1) * size, p * size), pageCount, page: p };
}
