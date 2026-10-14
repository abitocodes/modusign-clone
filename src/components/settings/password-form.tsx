"use client";

import { Check, Eye, EyeOff } from "lucide-react";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import { changePassword } from "@/app/workspaces/[wid]/settings/personal/password/actions";
import { useWorkspace } from "@/components/shell/workspace-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { PASSWORD_MAX, PASSWORD_MIN, passwordProblem } from "./shared";
import { CardTitle, SettingsCard } from "./ui";

function SecretInput({
  id,
  value,
  onChange,
  placeholder,
  autoComplete,
  invalid,
  autoFocus,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoComplete: string;
  invalid?: boolean;
  autoFocus?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <Input
      id={id}
      type={show ? "text" : "password"}
      value={value}
      maxLength={PASSWORD_MAX}
      autoComplete={autoComplete}
      placeholder={placeholder}
      invalid={invalid}
      autoFocus={autoFocus}
      className="h-10"
      onChange={(e) => onChange(e.target.value)}
      right={
        <button
          type="button"
          aria-label={show ? "비밀번호 숨기기" : "비밀번호 보기"}
          onClick={() => setShow((s) => !s)}
          className="flex size-8 items-center justify-center text-fg-faint hover:text-fg"
        >
          {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      }
    />
  );
}

function Rule({ ok, children }: { ok: boolean; children: string }) {
  return (
    <li className={cn("flex items-center gap-1.5 text-xs", ok ? "text-positive" : "text-fg-muted")}>
      <Check className="size-3.5" strokeWidth={3} />
      {children}
    </li>
  );
}

export function PasswordForm() {
  const { profile } = useWorkspace();
  const uid = useId();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const nextErr = next ? passwordProblem(next) : null;
  const mismatch = confirm.length > 0 && confirm !== next;
  const valid = !!current && !!next && !nextErr && confirm === next && next !== current;

  const submit = () => {
    if (!valid || pending) return;
    setError(null);
    startTransition(async () => {
      const r = await changePassword({ current, next, confirm });
      if (!r.ok) {
        setError(r.error);
        toast.error(r.error);
        return;
      }
      setCurrent("");
      setNext("");
      setConfirm("");
      toast.success("비밀번호를 변경했습니다. 다음 로그인부터 새 비밀번호를 사용해 주세요.");
    });
  };

  return (
    <SettingsCard>
      <CardTitle title="비밀번호 변경" description="로그인에 사용하는 비밀번호를 변경합니다. 주기적으로 변경하면 계정을 더 안전하게 지킬 수 있습니다." />
      <form
        className="mt-7 max-w-[480px] space-y-5"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {/* helps password managers associate the fields with the account */}
        <input type="text" name="username" autoComplete="username" value={profile.username ?? profile.email} hidden readOnly />
        <div>
          <label htmlFor={`${uid}-current`} className="mb-2 block text-sm font-medium text-fg">
            현재 비밀번호
          </label>
          <SecretInput
            id={`${uid}-current`}
            value={current}
            onChange={(v) => {
              setCurrent(v);
              setError(null);
            }}
            placeholder="현재 비밀번호 입력"
            autoComplete="current-password"
            invalid={!!error && error.includes("현재 비밀번호")}
            autoFocus
          />
        </div>
        <div>
          <label htmlFor={`${uid}-next`} className="mb-2 block text-sm font-medium text-fg">
            새 비밀번호
          </label>
          <SecretInput
            id={`${uid}-next`}
            value={next}
            onChange={setNext}
            placeholder="새 비밀번호 입력"
            autoComplete="new-password"
            invalid={!!nextErr || (!!next && next === current)}
          />
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            <Rule ok={next.length >= PASSWORD_MIN}>{`${PASSWORD_MIN}자 이상`}</Rule>
            <Rule ok={/[a-zA-Z]/.test(next) && /[0-9]/.test(next)}>영문·숫자 포함</Rule>
            <Rule ok={!!next && !/\s/.test(next)}>공백 없음</Rule>
            <Rule ok={!!next && next !== current}>현재 비밀번호와 다름</Rule>
          </ul>
        </div>
        <div>
          <label htmlFor={`${uid}-confirm`} className="mb-2 block text-sm font-medium text-fg">
            새 비밀번호 확인
          </label>
          <SecretInput
            id={`${uid}-confirm`}
            value={confirm}
            onChange={setConfirm}
            placeholder="새 비밀번호 다시 입력"
            autoComplete="new-password"
            invalid={mismatch}
          />
          {mismatch && (
            <p role="alert" className="mt-1.5 text-xs text-negative">
              새 비밀번호가 일치하지 않습니다.
            </p>
          )}
        </div>
        {error && (
          <p role="alert" className="rounded-md border border-negative-border bg-negative-bg px-4 py-2.5 text-[13px] text-negative">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" size="lg" disabled={!valid || pending}>
          {pending ? "변경 중…" : "비밀번호 변경"}
        </Button>
      </form>
    </SettingsCard>
  );
}
