"use client";

import { WizardError } from "../_lib/wizard-error";

export default function ErrorBoundary({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <WizardError error={error} retry={retry} title="전송 결과를 불러오지 못했습니다." />;
}
