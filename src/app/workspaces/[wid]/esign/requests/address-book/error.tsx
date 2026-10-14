"use client";

import { ErrorState } from "@/components/tools/list-states";
import { ListPage, ListTitle } from "@/components/ui/list-page";

export default function AddressBookError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <ListPage>
      <ListTitle title="주소록" />
      <ErrorState title="연락처 목록을 불러오지 못했습니다." onRetry={retry} />
    </ListPage>
  );
}
