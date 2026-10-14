"use client";

import { ListErrorView } from "../_edit-kit/route-states";

export default function EditingDocumentsError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <ListErrorView heading="문서 편집기" title="편집 문서 목록을 불러오지 못했습니다." error={error} retry={retry} />;
}
