"use client";

import { ErrorState } from "@/components/tools/list-states";
import { ListPage, ListTitle } from "@/components/ui/list-page";

export default function LinksError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <ListPage>
      <ListTitle title="링크서명" />
      <ErrorState title="링크서명 목록을 불러오지 못했습니다." onRetry={retry} />
    </ListPage>
  );
}
