"use client";

import { useParams } from "next/navigation";

import { EditorErrorView } from "../../_edit-kit/route-states";

export default function DocumentEditorError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const { wid } = useParams<{ wid: string }>();
  return (
    <EditorErrorView
      title="편집 문서를 열지 못했습니다."
      backHref={`/workspaces/${wid}/esign/requests/editing-documents`}
      error={error}
      retry={retry}
    />
  );
}
