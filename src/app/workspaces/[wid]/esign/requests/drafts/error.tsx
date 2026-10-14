"use client";

import { ListErrorView } from "../_edit-kit/route-states";

export default function DraftsError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <ListErrorView heading="서식 작성기" title="서식 목록을 불러오지 못했습니다." error={error} retry={retry} />;
}
