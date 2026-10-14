"use client";

import { ErrorState } from "@/components/tools/list-states";
import { ListPage, ListTitle } from "@/components/ui/list-page";

export default function CustomFieldsError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <ListPage>
      <ListTitle title="맞춤 입력란" />
      <ErrorState title="맞춤 입력란을 불러오지 못했습니다." onRetry={retry} />
    </ListPage>
  );
}
