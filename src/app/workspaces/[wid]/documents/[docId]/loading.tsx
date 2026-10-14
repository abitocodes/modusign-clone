import { LoaderCircle } from "lucide-react";

export default function DocumentViewerLoading() {
  return (
    <div className="flex h-screen flex-col bg-body-2">
      <div className="h-16 shrink-0 border-b border-line bg-surface" />
      <div className="flex flex-1 items-center justify-center gap-2 text-sm text-fg-muted" role="status">
        <LoaderCircle className="size-5 animate-spin" />
        문서를 불러오는 중입니다.
      </div>
    </div>
  );
}
