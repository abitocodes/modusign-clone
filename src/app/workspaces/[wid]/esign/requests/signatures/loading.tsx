import { ListPage } from "@/components/ui/list-page";

export default function SignaturesLoading() {
  return (
    <ListPage>
      <div className="flex min-h-9 items-center justify-between" aria-busy="true" aria-label="사인·도장 불러오는 중">
        <div className="flex items-center gap-2">
          <div className="h-6 w-24 animate-pulse rounded bg-surface-4" />
          <div className="h-7 w-12 animate-pulse rounded-full bg-surface-4" />
          <div className="h-7 w-24 animate-pulse rounded-full bg-surface-4" />
        </div>
        <div className="flex gap-2">
          <div className="h-9 w-[100px] animate-pulse rounded bg-surface-4" />
          <div className="h-9 w-[100px] animate-pulse rounded bg-surface-4" />
        </div>
      </div>
      <div className="mt-5 grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-[210px] animate-pulse rounded border border-line bg-surface-2" />
        ))}
      </div>
    </ListPage>
  );
}
