"use client";

import { CircleAlert, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";

import { verifyIdentity } from "../actions";
import { callAction } from "../_lib/types";
import { Card, CardPage } from "./chrome";
import { AvatarIllustration } from "./illustrations";

const inputCls =
  "h-10 w-full rounded border border-line-strong bg-surface px-3 text-sm text-fg outline-none transition-colors placeholder:text-fg-disabled focus:border-emphasis focus:shadow-focus";

/** 본인 확인 필요: e-mail (or phone digits) + optional 인증 비밀번호, then a fraud warning. */
export function IdentityCheck({ token, check, needPassword }: { token: string; check: "email" | "phone"; needPassword: boolean }) {
  const router = useRouter();
  const ids = { id: useId(), pw: useId(), err: useId() };
  const [value, setValue] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<{ field: "id" | "password" | "form"; message: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const ready = value.trim().length > 0 && (!needPassword || password.length > 0);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!ready || pending) return;
    setError(null);
    startTransition(async () => {
      const res = await callAction(() => verifyIdentity(token, check === "email" ? { email: value, password } : { phone: value, password }));
      if (!res.ok) {
        const f = "field" in res ? res.field : undefined;
        const field = f === "password" ? "password" : f ? "id" : "form";
        setError({ field, message: res.error });
        return;
      }
      router.refresh();
    });
  };

  const description =
    check === "email"
      ? needPassword
        ? "메일을 받은 이메일 주소와 전달받은 비밀번호를 입력하세요."
        : "메일을 받은 이메일 주소를 입력하세요."
      : needPassword
        ? "휴대폰 번호 뒷자리 4자리와 전달받은 비밀번호를 입력하세요."
        : "서명 요청을 받은 휴대폰 번호 뒷자리 4자리를 입력하세요.";

  return (
    <CardPage>
      <Card className="max-w-[414px] px-6 pb-9 pt-14">
        <form onSubmit={submit} noValidate className="flex flex-col items-center text-center">
          <AvatarIllustration />
          <h1 className="mt-5 text-xl font-bold text-fg">본인 확인 필요</h1>
          <p className="mt-2 text-[13px] font-medium text-fg-2">{description}</p>

          <div className="mt-8 flex w-full max-w-[320px] flex-col gap-2 text-left">
            <label htmlFor={ids.id} className="sr-only">
              {check === "email" ? "이메일 주소" : "휴대폰 번호 뒷자리 4자리"}
            </label>
            <input
              id={ids.id}
              type={check === "email" ? "email" : "text"}
              inputMode={check === "email" ? "email" : "numeric"}
              autoComplete={check === "email" ? "email" : "off"}
              maxLength={check === "email" ? 254 : 4}
              placeholder={check === "email" ? "이메일 주소" : "휴대폰 번호 뒷자리 4자리"}
              value={value}
              autoFocus
              onChange={(e) => {
                setValue(check === "email" ? e.target.value : e.target.value.replace(/\D/g, "").slice(0, 4));
                if (error?.field === "id") setError(null);
              }}
              aria-invalid={error?.field === "id"}
              aria-describedby={error?.field === "id" ? ids.err : undefined}
              className={cn(inputCls, error?.field === "id" && "border-negative focus:border-negative")}
            />
            {needPassword && (
              <>
                <label htmlFor={ids.pw} className="sr-only">
                  비밀번호
                </label>
                <input
                  id={ids.pw}
                  type="password"
                  autoComplete="off"
                  maxLength={40}
                  placeholder="비밀번호"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (error?.field === "password") setError(null);
                  }}
                  aria-invalid={error?.field === "password"}
                  aria-describedby={error?.field === "password" ? ids.err : undefined}
                  className={cn(inputCls, error?.field === "password" && "border-negative focus:border-negative")}
                />
              </>
            )}
            {error && (
              <p id={ids.err} role="alert" className="text-xs text-negative">
                {error.message}
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={!ready || pending}
            className={cn(
              "mt-6 flex h-10 min-w-[102px] items-center justify-center gap-1.5 rounded px-4 text-base font-medium transition-colors",
              ready
                ? "bg-primary text-primary-fg shadow-button hover:bg-primary-hover"
                : "border border-line bg-btn-disabled text-fg-disabled",
            )}
          >
            {pending && <LoaderCircle className="size-4 animate-spin" />}
            다음으로
          </button>
        </form>
      </Card>

      <FraudWarning />
    </CardPage>
  );
}

/** "사기, 사칭에 주의해주세요" box under the identity check */
export function FraudWarning() {
  return (
    <div role="note" className="mt-3 w-full max-w-[414px] rounded-xl border border-warning-border bg-warning-bg p-4">
      <div className="flex items-start gap-2">
        <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning-strong" strokeWidth={2.2} />
        <div className="min-w-0">
          <p className="text-sm font-bold text-fg">사기, 사칭에 주의해주세요</p>
          <p className="mt-1.5 text-sm text-fg-2">불법, 사기가 의심되는 문서라면 신고해주세요.</p>
          <button
            type="button"
            onClick={() => toast.success("제보가 접수되었습니다. 담당자가 확인 후 조치하겠습니다.")}
            className="mt-2 h-7 rounded border border-line-strong bg-btn-light px-2.5 text-[13px] font-semibold text-fg hover:bg-btn-base"
          >
            제보하기
          </button>
        </div>
      </div>
    </div>
  );
}
