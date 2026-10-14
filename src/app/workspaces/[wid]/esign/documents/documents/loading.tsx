import { ListPage } from "@/components/ui/list-page";

/** Skeleton of the 문서함 while the list loads. */
export default function DocumentsLoading() {
  return (
    <ListPage>
      <div role="status" aria-label="문서 목록을 불러오는 중" className="animate-pulse">
        <div className="flex h-9 items-center justify-between">
          <div className="h-6 w-40 rounded bg-surface-4" />
          <div className="h-9 w-28 rounded bg-surface-4" />
        </div>
        <div className="mt-5 h-[102px] rounded-lg border border-line-strong bg-surface-3" />
        <div className="mt-4 h-[38px] border-b border-line-strong" />
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex h-[72px] items-center gap-6 border-b border-line px-3">
            <div className="size-4 rounded-sm bg-surface-4" />
            <div className="h-[22px] w-24 rounded bg-surface-4" />
            <div className="flex-1 space-y-2">
              <div className="h-3.5 w-1/3 rounded bg-surface-4" />
              <div className="h-3 w-1/4 rounded bg-surface-3" />
            </div>
            <div className="h-3 w-20 rounded bg-surface-3" />
            <div className="h-3 w-20 rounded bg-surface-3" />
            <div className="size-8 rounded-lg bg-surface-4" />
          </div>
        ))}
      </div>
    </ListPage>
  );
}
