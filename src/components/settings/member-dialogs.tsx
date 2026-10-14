"use client";

import { Check, Copy, Dices, Eye, EyeOff, KeyRound, Pencil, UserCog, UserPlus } from "lucide-react";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  addMember,
  changeMemberRole,
  resetMemberPassword,
  updateMemberInfo,
} from "@/app/workspaces/[wid]/settings/workspace/members/actions";
import { useWorkspace } from "@/components/shell/workspace-context";
import { Button } from "@/components/ui/button";
import { Radio } from "@/components/ui/controls";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import type { MemberRole } from "@/lib/types";
import { cn } from "@/lib/utils";

import {
  EMAIL_RE,
  generatePassword,
  NAME_MAX,
  ORG_MAX,
  PASSWORD_POLICY_TEXT,
  passwordProblem,
  ROLE_DESCRIPTION,
  ROLE_LABEL,
  type SettingsMember,
  usernameProblem,
} from "./shared";
import { Divider, FormRow } from "./ui";

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("클립보드에 복사했습니다.");
  } catch {
    toast.error("복사하지 못했습니다. 직접 선택해서 복사해 주세요.");
  }
}

/* ------------------------------------------------------------ password field */

function PasswordField({
  id,
  value,
  onChange,
  invalid,
  onBlur,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  invalid?: boolean;
  onBlur?: () => void;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="flex gap-2">
      <Input
        id={id}
        type={show ? "text" : "password"}
        value={value}
        autoComplete="new-password"
        maxLength={72}
        placeholder="8자 이상, 영문+숫자 포함"
        invalid={invalid}
        onBlur={onBlur}
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
      <Button
        variant="outline"
        icon={<Dices className="size-4" />}
        onClick={() => {
          onChange(generatePassword());
          setShow(true);
        }}
      >
        자동 생성
      </Button>
    </div>
  );
}

/** Shows the credentials that were just issued so the admin can hand them over. */
function CredentialSummary({ rows, note }: { rows: { label: string; value: string }[]; note: string }) {
  const text = rows.map((r) => `${r.label}: ${r.value}`).join("\n");
  return (
    <div className="px-[30px] pb-2 pt-6">
      <div className="flex items-center gap-2 text-base font-bold text-fg">
        <span className="flex size-6 items-center justify-center rounded-full bg-positive-bg text-positive">
          <Check className="size-4" strokeWidth={3} />
        </span>
        {note}
      </div>
      <dl className="mt-5 rounded-lg border border-line-light bg-surface-3 px-5 py-4">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center py-1.5 text-sm">
            <dt className="w-[108px] shrink-0 text-[13px] font-medium text-fg-muted">{r.label}</dt>
            <dd className="min-w-0 flex-1 break-all font-medium text-fg">{r.value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs leading-relaxed text-fg-muted">
        비밀번호는 이 화면을 닫으면 다시 확인할 수 없습니다. 멤버에게 안전한 방법으로 전달하고, 첫 로그인 후 비밀번호를 변경하도록 안내해 주세요.
      </p>
      <Button variant="outline" className="mt-4" icon={<Copy className="size-4" />} onClick={() => copyText(text)}>
        계정 정보 복사
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ 멤버 추가 */

interface AddForm {
  name: string;
  username: string;
  email: string;
  password: string;
  department: string;
  position: string;
  role: "admin" | "member";
}

const EMPTY_ADD: AddForm = { name: "", username: "", email: "", password: "", department: "", position: "", role: "member" };

export function AddMemberDialog({ onClose }: { onClose: () => void }) {
  const { workspace } = useWorkspace();
  const uid = useId();
  const [form, setForm] = useState<AddForm>(EMPTY_ADD);
  const [touched, setTouched] = useState<Partial<Record<keyof AddForm, boolean>>>({});
  const [done, setDone] = useState<{ existing: boolean; form: AddForm } | null>(null);
  const [pending, startTransition] = useTransition();

  const set = <K extends keyof AddForm>(k: K, v: AddForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const touch = (k: keyof AddForm) => setTouched((t) => ({ ...t, [k]: true }));

  const errors: Partial<Record<keyof AddForm, string>> = {
    name: !form.name.trim() ? "이름을 입력해 주세요." : undefined,
    username: usernameProblem(form.username.trim()) ?? undefined,
    email: !EMAIL_RE.test(form.email.trim()) ? "올바른 이메일 주소를 입력해 주세요." : undefined,
    password: passwordProblem(form.password) ?? undefined,
  };
  const valid = !Object.values(errors).some(Boolean);
  const show = (k: keyof AddForm) => (touched[k] ? errors[k] : undefined);

  const submit = () => {
    if (!valid || pending) {
      setTouched({ name: true, username: true, email: true, password: true });
      return;
    }
    startTransition(async () => {
      const r = await addMember(workspace.id, {
        ...form,
        name: form.name.trim(),
        username: form.username.trim(),
        email: form.email.trim(),
      });
      if (!r.ok) return void toast.error(r.error);
      if (r.data.existing) {
        toast.success("이미 등록된 계정을 워크스페이스에 추가했습니다. (기존 비밀번호 유지)");
        onClose();
        return;
      }
      toast.success("멤버를 추가했습니다.");
      setDone({ existing: false, form });
    });
  };

  if (done) {
    return (
      <Modal
        open
        onClose={onClose}
        title="멤버 추가"
        icon={<UserPlus />}
        width={560}
        footer={
          <Button variant="primary" onClick={onClose}>
            확인
          </Button>
        }
      >
        <CredentialSummary
          note={`${done.form.name} 님의 계정을 만들었습니다.`}
          rows={[
            { label: "아이디", value: done.form.username.trim().toLowerCase() },
            { label: "이메일", value: done.form.email.trim().toLowerCase() },
            { label: "초기 비밀번호", value: done.form.password },
            { label: "역할", value: ROLE_LABEL[done.form.role] },
          ]}
        />
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="멤버 추가"
      icon={<UserPlus />}
      width={672}
      closeOnBackdrop={false}
      footer={
        <>
          <Button variant="light" onClick={onClose}>
            취소
          </Button>
          <Button variant="primary" type="submit" form={`${uid}-form`} disabled={pending}>
            {pending ? "추가 중…" : "추가"}
          </Button>
        </>
      }
    >
      <form
        id={`${uid}-form`}
        noValidate
        className="space-y-4 px-[30px] pb-4 pt-6"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <p className="rounded-md bg-emphasis-bg px-4 py-3 text-[13px] leading-relaxed text-fg-2">
          사내 직원 계정을 만듭니다. 멤버는 <b className="text-emphasis">아이디(또는 이메일)와 초기 비밀번호</b>로 로그인할 수 있습니다.
        </p>
        <FormRow label="이름" required htmlFor={`${uid}-name`} error={show("name")}>
          <Input
            id={`${uid}-name`}
            value={form.name}
            maxLength={NAME_MAX}
            autoFocus
            placeholder={`${NAME_MAX}자 이내로 입력`}
            invalid={!!show("name")}
            onBlur={() => touch("name")}
            onChange={(e) => set("name", e.target.value)}
          />
        </FormRow>
        <FormRow
          label="아이디"
          required
          htmlFor={`${uid}-username`}
          error={show("username")}
          hint="영문 소문자, 숫자, 마침표(.), 밑줄(_), 하이픈(-) 2~30자"
        >
          <Input
            id={`${uid}-username`}
            value={form.username}
            maxLength={30}
            autoComplete="off"
            placeholder="예: hong.gildong"
            invalid={!!show("username")}
            onBlur={() => touch("username")}
            onChange={(e) => set("username", e.target.value.toLowerCase().replace(/\s/g, ""))}
          />
        </FormRow>
        <FormRow label="이메일" required htmlFor={`${uid}-email`} error={show("email")}>
          <Input
            id={`${uid}-email`}
            type="email"
            value={form.email}
            maxLength={254}
            autoComplete="off"
            placeholder="이메일 주소"
            invalid={!!show("email")}
            onBlur={() => touch("email")}
            onChange={(e) => set("email", e.target.value)}
          />
        </FormRow>
        <FormRow label="초기 비밀번호" required htmlFor={`${uid}-password`} error={show("password")} hint={PASSWORD_POLICY_TEXT}>
          <PasswordField
            id={`${uid}-password`}
            value={form.password}
            invalid={!!show("password")}
            onBlur={() => touch("password")}
            onChange={(v) => set("password", v)}
          />
        </FormRow>
        <Divider />
        <FormRow label="부서" htmlFor={`${uid}-dept`}>
          <Input
            id={`${uid}-dept`}
            value={form.department}
            maxLength={ORG_MAX}
            placeholder="예: 경영지원팀"
            onChange={(e) => set("department", e.target.value)}
          />
        </FormRow>
        <FormRow label="직위" htmlFor={`${uid}-position`}>
          <Input
            id={`${uid}-position`}
            value={form.position}
            maxLength={ORG_MAX}
            placeholder="예: 대리"
            onChange={(e) => set("position", e.target.value)}
          />
        </FormRow>
        <Divider />
        <FormRow label="역할" required>
          <div className="flex h-9 items-center gap-5" role="radiogroup" aria-label="역할">
            <Radio name={`${uid}-role`} checked={form.role === "member"} onChange={() => set("role", "member")} label="멤버" />
            <Radio name={`${uid}-role`} checked={form.role === "admin"} onChange={() => set("role", "admin")} label="관리자" />
          </div>
          <p className="mt-1 text-xs text-fg-muted">{ROLE_DESCRIPTION[form.role]}</p>
        </FormRow>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ 역할 변경 */

export function RoleDialog({
  member,
  callerRole,
  onClose,
}: {
  member: SettingsMember;
  callerRole: MemberRole;
  onClose: () => void;
}) {
  const { workspace } = useWorkspace();
  const [role, setRole] = useState<MemberRole>(member.role);
  const [pending, startTransition] = useTransition();
  const options: MemberRole[] = ["owner", "admin", "member"];
  const lockedOwner = member.role === "owner" && callerRole !== "owner";

  const submit = () =>
    startTransition(async () => {
      const r = await changeMemberRole(workspace.id, member.id, role);
      if (!r.ok) return void toast.error(r.error);
      toast.success(`${member.name} 님의 역할을 ${ROLE_LABEL[role]}(으)로 변경했습니다.`);
      onClose();
    });

  return (
    <Modal
      open
      onClose={onClose}
      title="역할 변경"
      icon={<UserCog />}
      width={520}
      footer={
        <>
          <Button variant="light" onClick={onClose}>
            취소
          </Button>
          <Button variant="primary" disabled={pending || role === member.role || lockedOwner} onClick={submit}>
            {pending ? "변경 중…" : "변경"}
          </Button>
        </>
      }
    >
      <div className="px-[30px] pb-2 pt-6">
        <p className="text-sm text-fg-2">
          <b className="text-fg">{member.name}</b>
          <span className="text-[13px] text-fg-faint">({member.email})</span> 님의 역할을 선택해 주세요.
        </p>
        {lockedOwner && (
          <p className="mt-3 rounded-md border border-warning-border bg-warning-bg px-4 py-2.5 text-[13px] text-fg-2">
            최고 관리자의 역할은 최고 관리자만 변경할 수 있습니다.
          </p>
        )}
        <div role="radiogroup" aria-label="역할" className="mt-4 space-y-2">
          {options.map((o) => {
            const disabled = lockedOwner || (o === "owner" && callerRole !== "owner");
            return (
              <label
                key={o}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 transition-colors",
                  role === o ? "border-emphasis bg-emphasis-bg" : "border-line-light hover:bg-surface-3",
                  disabled && "cursor-default opacity-45 hover:bg-transparent",
                )}
              >
                <input
                  type="radio"
                  name="member-role"
                  aria-label={ROLE_LABEL[o]}
                  className="peer sr-only"
                  checked={role === o}
                  disabled={disabled}
                  onChange={() => setRole(o)}
                />
                <span
                  className={cn(
                    "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border shadow-input peer-focus-visible:ring-2 peer-focus-visible:ring-emphasis",
                    role === o ? "border-radio-on bg-radio-on" : "border-line bg-surface",
                  )}
                >
                  {role === o && <span className="size-1.5 rounded-full bg-white" />}
                </span>
                <span>
                  <span className="block text-sm font-bold text-fg">{ROLE_LABEL[o]}</span>
                  <span className="mt-0.5 block text-[13px] text-fg-muted">{ROLE_DESCRIPTION[o]}</span>
                </span>
              </label>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ 정보 수정 */

export function EditMemberDialog({ member, onClose }: { member: SettingsMember; onClose: () => void }) {
  const { workspace } = useWorkspace();
  const uid = useId();
  const [name, setName] = useState(member.name);
  const [username, setUsername] = useState(member.username ?? "");
  const [department, setDepartment] = useState(member.department ?? "");
  const [position, setPosition] = useState(member.position ?? "");
  const [pending, startTransition] = useTransition();

  const nameErr = !name.trim() ? "이름을 입력해 주세요." : undefined;
  const userErr = usernameProblem(username.trim()) ?? undefined;
  const valid = !nameErr && !userErr;

  const submit = () => {
    if (!valid || pending) return;
    startTransition(async () => {
      const r = await updateMemberInfo(workspace.id, member.id, { name, username, department, position });
      if (!r.ok) return void toast.error(r.error);
      toast.success("멤버 정보를 수정했습니다.");
      onClose();
    });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="멤버 정보 수정"
      icon={<Pencil />}
      width={600}
      footer={
        <>
          <Button variant="light" onClick={onClose}>
            취소
          </Button>
          <Button variant="primary" type="submit" form={`${uid}-form`} disabled={!valid || pending}>
            {pending ? "저장 중…" : "저장"}
          </Button>
        </>
      }
    >
      <form
        id={`${uid}-form`}
        className="space-y-4 px-[30px] pb-4 pt-6"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <FormRow label="이메일">
          <p className="flex h-9 items-center text-sm text-fg-muted">{member.email}</p>
        </FormRow>
        <FormRow label="이름" required htmlFor={`${uid}-name`} error={nameErr}>
          <Input id={`${uid}-name`} value={name} maxLength={NAME_MAX} autoFocus onChange={(e) => setName(e.target.value)} />
        </FormRow>
        <FormRow label="아이디" required htmlFor={`${uid}-username`} error={userErr}>
          <Input
            id={`${uid}-username`}
            value={username}
            maxLength={30}
            onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/\s/g, ""))}
          />
        </FormRow>
        <FormRow label="부서" htmlFor={`${uid}-dept`}>
          <Input id={`${uid}-dept`} value={department} maxLength={ORG_MAX} onChange={(e) => setDepartment(e.target.value)} />
        </FormRow>
        <FormRow label="직위" htmlFor={`${uid}-position`}>
          <Input id={`${uid}-position`} value={position} maxLength={ORG_MAX} onChange={(e) => setPosition(e.target.value)} />
        </FormRow>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------ 비밀번호 초기화 */

export function ResetPasswordDialog({ member, onClose }: { member: SettingsMember; onClose: () => void }) {
  const { workspace } = useWorkspace();
  const uid = useId();
  const [password, setPassword] = useState(() => generatePassword());
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();
  const err = passwordProblem(password) ?? undefined;

  const submit = () => {
    if (err || pending) return;
    startTransition(async () => {
      const r = await resetMemberPassword(workspace.id, member.id, password);
      if (!r.ok) return void toast.error(r.error);
      toast.success("비밀번호를 초기화했습니다.");
      setDone(true);
    });
  };

  if (done) {
    return (
      <Modal
        open
        onClose={onClose}
        title="비밀번호 초기화"
        icon={<KeyRound />}
        width={560}
        footer={
          <Button variant="primary" onClick={onClose}>
            확인
          </Button>
        }
      >
        <CredentialSummary
          note={`${member.name} 님의 비밀번호를 초기화했습니다.`}
          rows={[
            { label: "아이디", value: member.username ?? member.email },
            { label: "새 비밀번호", value: password },
          ]}
        />
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="비밀번호 초기화"
      icon={<KeyRound />}
      width={600}
      footer={
        <>
          <Button variant="light" onClick={onClose}>
            취소
          </Button>
          <Button variant="primary" type="submit" form={`${uid}-form`} disabled={!!err || pending}>
            {pending ? "초기화 중…" : "초기화"}
          </Button>
        </>
      }
    >
      <form
        id={`${uid}-form`}
        className="space-y-4 px-[30px] pb-4 pt-6"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <p className="text-sm leading-relaxed text-fg-2">
          <b className="text-fg">{member.name}</b>
          <span className="text-[13px] text-fg-faint">({member.email})</span> 님의 비밀번호를 새 비밀번호로 바꿉니다. 기존 비밀번호로는 더 이상 로그인할 수 없습니다.
        </p>
        <FormRow label="새 비밀번호" required htmlFor={`${uid}-pw`} error={err} hint={PASSWORD_POLICY_TEXT}>
          <PasswordField id={`${uid}-pw`} value={password} onChange={setPassword} invalid={!!err} />
        </FormRow>
      </form>
    </Modal>
  );
}
