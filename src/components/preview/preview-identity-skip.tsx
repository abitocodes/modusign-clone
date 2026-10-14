"use client";

import { LoaderCircle, UserCheck } from "lucide-react";

import { PREVIEW } from "@/lib/preview/flag";
import { cn } from "@/lib/utils";

import { PreviewBox, previewButtonCls } from "./preview-box";

/**
 * 본인 확인 화면: "본인 확인 건너뛰기 (미리보기)" — the page runs the normal identity check with the
 * invited contact (and 인증 비밀번호). Renders nothing unless PREVIEW is on.
 */
export function PreviewIdentitySkip({
  contact,
  password,
  busy,
  onSkip,
  className,
}: {
  /** invited e-mail address / last 4 digits of the phone */
  contact: string | null;
  password: string | null;
  busy: boolean;
  onSkip: () => void;
  className?: string;
}) {
  if (!PREVIEW) return null;
  return (
    <PreviewBox className={className}>
      <p className="mt-1.5 text-[13px] leading-relaxed text-fg-2">
        초대받은 정보{contact ? ` (${contact}${password ? " · 비밀번호 " + password : ""})` : ""}로 본인 확인을 진행합니다.
      </p>
      <button type="button" onClick={onSkip} disabled={busy} className={cn(previewButtonCls, "mt-2.5 w-full")}>
        {busy ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> : <UserCheck className="size-3.5" aria-hidden />}
        본인 확인 건너뛰기 (미리보기)
      </button>
    </PreviewBox>
  );
}
