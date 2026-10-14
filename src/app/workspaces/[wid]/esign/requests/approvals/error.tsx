"use client";

import { ErrorState } from "@/components/tools/list-states";
import { ListPage, ListTitle } from "@/components/ui/list-page";

export default function ApprovalsError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <ListPage>
      <ListTitle title="내부결재" />
      <ErrorState title="기안 문서 목록을 불러오지 못했습니다." onRetry={retry} />
    </ListPage>
  );
}
