"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";

import { SearchInput } from "@/components/ui/input";
import { FilterBar, Pagination } from "@/components/ui/list-page";
import { SelectMenu } from "@/components/ui/menu";

import { AUDIT_EVENT_TYPES } from "./audit-log-types";

function useNavigateWith() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [pending, startTransition] = useTransition();
  const go = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(search.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    const qs = next.toString();
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname));
  };
  return { go, pending };
}

/** Search + event type filter of 감사 로그 (state lives in the URL: ?q=&type=&page=). */
export function AuditLogControls({ q, type }: { q: string; type: string }) {
  const { go, pending } = useNavigateWith();
  const [text, setText] = useState(q);

  return (
    <FilterBar className={pending ? "opacity-70" : undefined}>
      <SearchInput
        wrapperClassName="w-[300px]"
        value={text}
        maxLength={100}
        onChange={(e) => setText(e.target.value)}
        onSearch={() => go({ q: text.trim() || null, page: null })}
        placeholder="이름, 이메일, 문서 제목, IP로 검색"
        aria-label="감사 로그 검색"
      />
      <SelectMenu<string>
        value={type || "all"}
        width={170}
        onChange={(v) => go({ type: v === "all" ? null : v, page: null })}
        options={[{ value: "all", label: "전체 활동" }, ...AUDIT_EVENT_TYPES]}
      />
      {(q || type) && (
        <button
          type="button"
          className="ml-1 text-[13px] text-fg-muted underline underline-offset-2 hover:text-fg-2"
          onClick={() => {
            setText("");
            go({ q: null, type: null, page: null });
          }}
        >
          초기화
        </button>
      )}
    </FilterBar>
  );
}

export function AuditLogPager({ page, pageCount }: { page: number; pageCount: number }) {
  const { go } = useNavigateWith();
  return <Pagination page={page} pageCount={pageCount} onChange={(p) => go({ page: p > 1 ? String(p) : null })} />;
}
