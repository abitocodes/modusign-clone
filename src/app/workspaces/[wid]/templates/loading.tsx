import { WizardLoading } from "@/app/workspaces/[wid]/documents/d/_lib/wizard-loading";

/** Template editor / 사용하기 routes (full screen, no app shell). */
export default function Loading() {
  return <WizardLoading label="템플릿을 불러오는 중입니다." background="body" />;
}
