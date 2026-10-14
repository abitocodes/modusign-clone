"use client";

import { ChevronDown, CircleAlert, LoaderCircle } from "lucide-react";
import { useActionState, useId, useState } from "react";

import { Checkbox } from "@/components/ui/controls";
import { cn } from "@/lib/utils";

import { startLinkSign, type LinkFormState } from "./actions";

const inputCls =
  "h-10 w-full rounded border border-line-strong bg-surface px-3 text-sm text-fg outline-none transition-colors placeholder:text-fg-disabled focus:border-emphasis focus:shadow-focus aria-[invalid=true]:border-negative";

/** 서명자 정보 입력: 이름 + 이메일 + 개인정보 동의 → creates the document and opens /sign/[token]. */
export function LinkSignForm({ token, title, verb }: { token: string; title: string; verb: "서명" | "열람" }) {
  const ids = { name: useId(), email: useId(), err: useId(), terms: useId() };
  const [state, action, pending] = useActionState<LinkFormState, FormData>(startLinkSign.bind(null, token), {
    error: null,
    field: null,
    values: { name: "", email: "" },
  });
  const [name, setName] = useState(state.values.name);
  const [email, setEmail] = useState(state.values.email);
  const [agree, setAgree] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);
  const ready = name.trim().length > 0 && email.trim().length > 0 && agree;

  return (
    <form action={action} className="mt-7 w-full max-w-[320px] text-left" noValidate aria-describedby={state.error ? ids.err : undefined}>
      <label htmlFor={ids.name} className="mb-1 block text-xs font-medium text-fg-muted">
        이름
      </label>
      <input
        id={ids.name}
        name="name"
        autoComplete="name"
        maxLength={50}
        required
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="이름"
        aria-invalid={state.field === "name"}
        className={inputCls}
      />
      <label htmlFor={ids.email} className="mb-1 mt-3 block text-xs font-medium text-fg-muted">
        이메일
      </label>
      <input
        id={ids.email}
        name="email"
        type="email"
        inputMode="email"
        autoComplete="email"
        maxLength={254}
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="이메일 주소"
        aria-invalid={state.field === "email"}
        className={inputCls}
      />
      <p className="mt-1.5 text-xs leading-relaxed text-fg-faint">입력한 이메일로 {verb} 요청과 완료된 문서가 전송됩니다.</p>

      <div className={cn("mt-4 rounded border bg-surface-3 px-3 py-2.5", state.field === "agree" ? "border-negative" : "border-line")}>
        <div className="flex items-center justify-between gap-2">
          <Checkbox name="agree" checked={agree} onChange={setAgree} label={<span className="text-[13px]">[필수] 개인정보 수집·이용 동의</span>} />
          <button
            type="button"
            aria-expanded={termsOpen}
            aria-controls={ids.terms}
            onClick={() => setTermsOpen((v) => !v)}
            className="flex items-center gap-0.5 text-xs text-fg-muted hover:text-fg-2"
          >
            보기
            <ChevronDown className={cn("size-3.5 transition-transform", termsOpen && "rotate-180")} />
          </button>
        </div>
        {termsOpen && (
          <dl id={ids.terms} className="mt-2 space-y-1 border-t border-line-light pt-2 text-xs leading-relaxed text-fg-muted">
            <div className="flex gap-2">
              <dt className="w-14 shrink-0 font-medium text-fg-2">수집 항목</dt>
              <dd>이름, 이메일 주소, 서명 및 입력 내용, 접속 IP</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-14 shrink-0 font-medium text-fg-2">이용 목적</dt>
              <dd>&lsquo;{title}&rsquo; 문서의 전자서명 진행, 진행·완료 안내 메일 발송, 감사 추적 기록</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-14 shrink-0 font-medium text-fg-2">보유 기간</dt>
              <dd>문서를 요청한 회사의 문서 보관 기간 동안</dd>
            </div>
          </dl>
        )}
      </div>

      {state.error && (
        <p id={ids.err} role="alert" className="mt-3 flex items-start gap-1.5 text-xs text-negative">
          <CircleAlert className="mt-px size-3.5 shrink-0" />
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={!ready || pending}
        className="mt-5 flex h-10 w-full items-center justify-center gap-1.5 rounded bg-primary text-sm font-medium text-primary-fg shadow-button transition-colors hover:bg-primary-hover disabled:border disabled:border-line disabled:bg-btn-disabled disabled:text-fg-disabled disabled:shadow-none"
      >
        {pending && <LoaderCircle className="size-4 animate-spin" />}
        {pending ? "문서를 준비하는 중…" : `${verb} 시작하기`}
      </button>
    </form>
  );
}
