"use client";

import { useState } from "react";

import { FilterBar } from "@/components/ui/list-page";
import { SearchInput, Select } from "@/components/ui/input";
import { SelectMenu } from "@/components/ui/menu";
import type { Label } from "@/lib/types";

import { DateRangeInput } from "../_components/date-range-input";

import {
  DATE_TYPE_OPTIONS,
  HIDDEN_OPTIONS,
  SCOPE_OPTIONS,
  SHARE_OPTIONS,
  type DateType,
  type DocListFilters,
  type HiddenFilter,
  type SearchScope,
  type ShareFilter,
} from "./filters";

/**
 * 2-row filter bar of the 문서함:
 *  [제목 ▾][문서 제목으로 찾기 🔍]  [마지막 활동일 ▾][YY.MM.DD ~ YY.MM.DD 📅]  [라벨 미선택 ▾]
 *  [모든 공유 문서 ▾]  [숨긴 문서 제외 ▾]
 */
export function DocumentsFilterBar({
  filters,
  labels,
  onChange,
}: {
  filters: DocListFilters;
  labels: Label[];
  onChange: (patch: Partial<DocListFilters>) => void;
}) {
  const [scope, setScope] = useState<SearchScope>(filters.scope);
  const [q, setQ] = useState(filters.q);
  const placeholder = SCOPE_OPTIONS.find((o) => o.value === scope)?.placeholder ?? "";

  const search = () => {
    const text = q.trim();
    if (text === filters.q && scope === filters.scope) return;
    onChange({ q: text, scope });
  };

  const labelOptions = [{ value: "", label: "라벨 미선택" }, ...labels.map((l) => ({ value: l.id, label: l.name }))];

  return (
    <FilterBar className="flex-col items-start gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-px">
          <Select
            aria-label="검색 기준"
            value={scope}
            wrapperClassName="w-[110px]"
            className="rounded-r-none"
            onChange={(e) => {
              const next = e.target.value as SearchScope;
              setScope(next);
              if (q.trim()) onChange({ scope: next, q: q.trim() });
            }}
          >
            {SCOPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          <SearchInput
            aria-label={placeholder}
            wrapperClassName="w-[240px]"
            className="rounded-l-none"
            placeholder={placeholder}
            value={q}
            maxLength={100}
            onChange={(e) => setQ(e.target.value)}
            onSearch={search}
          />
        </div>

        <div className="flex items-center gap-px">
          <Select
            aria-label="기간 기준"
            value={filters.dt}
            wrapperClassName="w-[130px]"
            className="rounded-r-none"
            onChange={(e) => onChange({ dt: e.target.value as DateType })}
          >
            {DATE_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          <DateRangeInput
            from={filters.from}
            to={filters.to}
            inputClassName="rounded-l-none"
            ariaLabel={`${DATE_TYPE_OPTIONS.find((o) => o.value === filters.dt)?.label ?? "기간"} 범위`}
            onApply={(from, to) => onChange({ from, to })}
          />
        </div>

        <SelectMenu value={filters.label} options={labelOptions} width={180} onChange={(v) => onChange({ label: v })} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <SelectMenu<ShareFilter> value={filters.share} options={SHARE_OPTIONS} width={140} onChange={(v) => onChange({ share: v })} />
        <Select
          aria-label="숨긴 문서"
          value={filters.hidden}
          wrapperClassName="w-[140px]"
          onChange={(e) => onChange({ hidden: e.target.value as HiddenFilter })}
        >
          {HIDDEN_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </div>
    </FilterBar>
  );
}
