import { PREVIEW } from "@/lib/preview/flag";

import { PreviewBox } from "./preview-box";

/** 로그인 화면: any id / password signs in as the demo admin in preview mode. */
export function PreviewLoginHint({ className }: { className?: string }) {
  if (!PREVIEW) return null;
  return (
    <PreviewBox title="미리보기 모드" className={className}>
      <p className="mt-1.5 text-[13px] leading-relaxed text-fg-2">
        아무 아이디·비밀번호나 입력하면 데모 관리자로 로그인됩니다. 다른 멤버로 보려면 아이디에 minsu 또는 seoyeon을 입력하세요.
      </p>
    </PreviewBox>
  );
}

/** Prefilled 아이디 of the login form in preview mode. */
export const PREVIEW_LOGIN_ID = PREVIEW ? "admin" : undefined;
