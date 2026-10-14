"use client";

import { ErrorState } from "@/components/tools/list-states";
import { ListPage, ListTitle } from "@/components/ui/list-page";

export default function ApprovalProcessesError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <ListPage>
      <ListTitle title="결재선" />
      <ErrorState title="결재선 목록을 불러오지 못했습니다." onRetry={retry} />
    </ListPage>
  );
}
