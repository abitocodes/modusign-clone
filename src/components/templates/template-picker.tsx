"use client";

import { Check, FileText, Plus } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { SearchInput } from "@/components/ui/input";
import { singleRoleIssue, type TemplateOption } from "@/lib/templates/model";
import { cn, fmtDate } from "@/lib/utils";

import { RequestTypeChip } from "./parts";

/**
 * Template list for flows that send to one person per document (대량전송 / 링크서명):
 * templates with more than one role (or no signature field) are shown disabled with the reason.
 */
export function TemplatePicker({
  wid,
  templates,
  value,
  onChange,
  purpose,
}: {
  wid: string;
  templates: TemplateOption[];
  value: string | null;
  onChange: (id: string) => void;
  purpose: string;
}) {
  const [query, setQuery] = useState("");
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = q ? templates.filter((t) => t.title.toLowerCase().includes(q)) : templates;
    // usable templates first
    return [...rows].sort((a, b) => Number(!!singleRoleIssue(a)) - Number(!!singleRoleIssue(b)) || b.updatedAt.localeCompare(a.updatedAt));
  }, [templates, query]);

  if (templates.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-md border border-dashed border-line-strong bg-surface-3 px-6 py-12 text-center">
        <FileText className="size-8 text-fg-disabled" strokeWidth={1.5} />
        <p className="text-sm font-medium text-fg-2">사용할 수 있는 템플릿이 없습니다.</p>
        <p className="text-[13px] text-fg-muted">{purpose}에는 참여자 역할이 1개인 템플릿이 필요합니다.</p>
        <Link
          href={`/workspaces/${wid}/templates/new`}
          className="mt-1 inline-flex h-9 items-center gap-1.5 rounded bg-btn-dark px-3.5 text-sm font-medium text-fg-2 hover:bg-btn-hover"
        >
          <Plus className="size-4" />
          템플릿 등록
        </Link>
      </div>
    );
  }

  return (
    <div>
      <SearchInput placeholder="템플릿 제목으로 검색" aria-label="템플릿 제목으로 검색" value={query} onChange={(e) => setQuery(e.target.value)} />
      <ul role="radiogroup" aria-label="템플릿 선택" className="mt-3 max-h-[340px] overflow-y-auto rounded-md border border-line bg-surface-3">
        {list.length === 0 && <li className="px-4 py-10 text-center text-[13px] text-fg-muted">검색 결과가 없습니다.</li>}
        {list.map((t) => {
          const issue = singleRoleIssue(t);
          const active = value === t.id;
          return (
            <li key={t.id} className="border-b border-line-light last:border-b-0">
              <button
                type="button"
                role="radio"
                aria-checked={active}
                aria-disabled={!!issue}
                disabled={!!issue}
                onClick={() => onChange(t.id)}
                className={cn(
                  "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors",
                  active ? "bg-emphasis-bg" : "hover:bg-surface-4",
                  issue && "cursor-not-allowed opacity-50 hover:bg-transparent",
                )}
              >
                <span
                  className={cn(
                    "flex size-4 shrink-0 items-center justify-center rounded-full border",
                    active ? "border-radio-on bg-radio-on" : "border-line bg-surface",
                  )}
                  aria-hidden
                >
                  {active && <Check className="size-2.5 text-white" strokeWidth={4} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium text-fg">{t.title}</span>
                    <RequestTypeChip type={t.requestType} className="h-[18px] shrink-0 px-1.5 text-[11px]" />
                  </span>
                  <span className={cn("mt-0.5 block truncate text-xs", issue ? "text-warning" : "text-fg-muted")}>
                    {issue ?? `역할: ${t.roleName} · ${t.pageCount}페이지 · 입력란 ${t.fieldCount}개 · ${fmtDate(t.updatedAt)} 수정`}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-xs text-fg-faint">{purpose}에는 참여자 역할이 1개인 템플릿만 사용할 수 있습니다.</p>
    </div>
  );
}
