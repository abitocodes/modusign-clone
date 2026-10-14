"use client";

import Link from "next/link";
import { useParams } from "next/navigation";

import { ErrorState } from "@/components/tools/list-states";

export default function ApprovalDetailError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const { wid } = useParams<{ wid: string }>();
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-body">
      <ErrorState title="기안 문서를 불러오지 못했습니다." onRetry={retry} />
      <Link href={`/workspaces/${wid}/esign/requests/approvals`} className="text-sm text-emphasis hover:underline">
        내부결재 목록으로
      </Link>
    </div>
  );
}
