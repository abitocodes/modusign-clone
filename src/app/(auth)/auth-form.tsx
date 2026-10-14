"use client";

import { Eye, EyeOff } from "lucide-react";
import { useActionState, useState } from "react";

import { PREVIEW_LOGIN_ID, PreviewLoginHint } from "@/components/preview";
import { Wordmark } from "@/components/shell/logo";
import { TextField } from "@/components/ui/input";
import { PREVIEW } from "@/lib/preview/flag";

import { signIn, type AuthState } from "./actions";

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState<AuthState, FormData>(signIn, {});
  const [show, setShow] = useState(false);

  return (
    <div className="flex min-h-screen flex-col items-center bg-body-2 px-4 pt-[12vh]">
      <div className="mb-9">
        <Wordmark className="text-[26px]" />
      </div>
      <div className="w-full max-w-[420px] rounded-xl border border-line bg-surface px-9 pb-9 pt-10 shadow-card">
        <h1 className="text-2xl font-bold text-fg">로그인</h1>
        <p className="mt-2 text-sm text-fg-muted">사내 계정의 아이디와 비밀번호를 입력하세요.</p>
        {PREVIEW && <PreviewLoginHint className="mt-5" />}

        <form action={action} className="mt-8 flex flex-col gap-4">
          {next && <input type="hidden" name="next" value={next} />}
          <TextField
            name="login"
            label="아이디"
            autoComplete="username"
            required
            autoFocus={!PREVIEW}
            defaultValue={PREVIEW_LOGIN_ID}
          />
          <TextField
            name="password"
            label="비밀번호"
            type={show ? "text" : "password"}
            autoComplete="current-password"
            required
            autoFocus={PREVIEW}
            right={
              <button
                type="button"
                aria-label={show ? "비밀번호 숨기기" : "비밀번호 보기"}
                onClick={() => setShow((s) => !s)}
                className="text-fg-muted hover:text-fg"
              >
                {show ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
              </button>
            }
          />

          {state.error && (
            <p role="alert" className="rounded-md border border-negative-border bg-negative-bg px-3 py-2.5 text-[13px] text-negative">
              {state.error}
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="mt-2 h-12 rounded-md bg-primary text-base font-bold text-primary-fg shadow-button hover:bg-primary-hover disabled:opacity-60"
          >
            {pending ? "로그인 중…" : "로그인"}
          </button>
        </form>

        <p className="mt-6 text-center text-[13px] leading-relaxed text-fg-muted">
          계정이 없거나 비밀번호를 잊으셨다면
          <br />
          사내 관리자에게 문의하세요.
        </p>
      </div>
      <p className="mt-8 text-xs text-fg-muted">© 2026 OpenSign. All rights reserved.</p>
    </div>
  );
}
