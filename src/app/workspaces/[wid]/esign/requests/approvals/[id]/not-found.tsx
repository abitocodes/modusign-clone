"use client";

import { FileQuestion } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";

export default function ApprovalNotFound() {
  const { wid } = useParams<{ wid: string }>();
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-body px-6 text-center">
      <FileQuestion className="size-10 text-fg-faint" strokeWidth={1.6} />
      <p className="text-base font-medium text-fg">기안 문서를 찾을 수 없습니다.</p>
      <p className="text-sm text-fg-muted">삭제되었거나, 기안자와 결재자만 볼 수 있는 문서입니다.</p>
      <Link href={`/workspaces/${wid}/esign/requests/approvals`} className="mt-2 text-sm text-emphasis hover:underline">
        내부결재 목록으로
      </Link>
    </div>
  );
}
