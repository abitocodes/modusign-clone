"use client";

import { useParams } from "next/navigation";

import { EditorErrorView } from "../../_edit-kit/route-states";

export default function DraftEditorError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const { wid } = useParams<{ wid: string }>();
  return (
    <EditorErrorView
      title="서식을 열지 못했습니다."
      backHref={`/workspaces/${wid}/esign/requests/drafts`}
      error={error}
      retry={retry}
    />
  );
}
