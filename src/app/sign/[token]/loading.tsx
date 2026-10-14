import { LoaderCircle } from "lucide-react";

export default function SignLoading() {
  return (
    <div className="flex min-h-dvh flex-col bg-body-2">
      <div className="h-[62px] shrink-0 border-b border-line bg-surface" />
      <div className="flex flex-1 items-center justify-center gap-2 text-sm text-fg-muted" role="status">
        <LoaderCircle className="size-5 animate-spin" />
        문서를 불러오는 중…
      </div>
    </div>
  );
}
