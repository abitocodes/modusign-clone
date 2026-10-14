"use client";

import { Pencil } from "lucide-react";
import Link from "next/link";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import { updateMyProfile } from "@/app/workspaces/[wid]/settings/personal/member/actions";
import { useWorkspace } from "@/components/shell/workspace-context";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/controls";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";

import { NAME_MAX, ORG_MAX, ROLE_LABEL } from "./shared";
import { CardTitle, Divider, FormRow, InfoRow, SettingsCard, TextButton } from "./ui";

export function MyMemberInfo({ groupNames, shareTargets }: { groupNames: string[]; shareTargets: string[] }) {
  const { profile, role, workspace } = useWorkspace();
  const [editing, setEditing] = useState(false);

  return (
    <SettingsCard>
      <CardTitle title="내 멤버 정보" />
      <dl className="mt-2.5">
        <InfoRow label="이름">
          <span className="flex min-w-0 items-center gap-2">
            <Avatar name={profile.name} size={24} color={profile.avatar_color} />
            <span className="truncate">
              <span className="font-medium">{profile.name}</span>
              <span className="text-[13px] text-fg-faint">({profile.email})</span>
            </span>
          </span>
          <TextButton onClick={() => setEditing(true)}>정보 수정</TextButton>
        </InfoRow>
        <InfoRow label="아이디">{profile.username ?? <span className="text-fg-muted">-</span>}</InfoRow>
        <InfoRow label="부서">{profile.department ?? <span className="text-fg-muted">-</span>}</InfoRow>
        <InfoRow label="직위">{profile.position ?? <span className="text-fg-muted">-</span>}</InfoRow>
        <InfoRow label="보유한 전체 역할">{ROLE_LABEL[role]}</InfoRow>
        <InfoRow label="시트">전자서명</InfoRow>
        <InfoRow label="소속 그룹">{["모든 멤버", ...groupNames].join(", ")}</InfoRow>
        <InfoRow label="문서 자동 공유">
          {shareTargets.length ? shareTargets.join(", ") : "없음"}
          <Link
            href={`/workspaces/${workspace.id}/settings/esign/automatic-sharing`}
            className="text-sm text-fg-muted underline decoration-fg-muted underline-offset-[3px] hover:text-fg-2"
          >
            설정
          </Link>
        </InfoRow>
      </dl>
      <Divider className="mt-6" />
      <p className="mt-4 text-xs text-fg-muted">아이디와 이메일 변경은 워크스페이스 관리자에게 요청해 주세요.</p>

      {editing && <EditProfileDialog onClose={() => setEditing(false)} />}
    </SettingsCard>
  );
}

function EditProfileDialog({ onClose }: { onClose: () => void }) {
  const { profile, workspace } = useWorkspace();
  const uid = useId();
  const [name, setName] = useState(profile.name);
  const [department, setDepartment] = useState(profile.department ?? "");
  const [position, setPosition] = useState(profile.position ?? "");
  const [pending, startTransition] = useTransition();
  const nameErr = name.trim() ? undefined : "이름을 입력해 주세요.";

  const submit = () => {
    if (nameErr || pending) return;
    startTransition(async () => {
      const r = await updateMyProfile(workspace.id, { name, department, position });
      if (!r.ok) return void toast.error(r.error);
      toast.success("내 정보를 저장했습니다.");
      onClose();
    });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="정보 수정"
      icon={<Pencil />}
      width={560}
      footer={
        <>
          <Button variant="light" onClick={onClose}>
            취소
          </Button>
          <Button variant="primary" type="submit" form={`${uid}-form`} disabled={!!nameErr || pending}>
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
        <FormRow label="이름" required htmlFor={`${uid}-name`} error={nameErr}>
          <Input id={`${uid}-name`} value={name} maxLength={NAME_MAX} autoFocus onChange={(e) => setName(e.target.value)} />
        </FormRow>
        <FormRow label="부서" htmlFor={`${uid}-dept`}>
          <Input id={`${uid}-dept`} value={department} maxLength={ORG_MAX} onChange={(e) => setDepartment(e.target.value)} />
        </FormRow>
        <FormRow label="직위" htmlFor={`${uid}-pos`}>
          <Input id={`${uid}-pos`} value={position} maxLength={ORG_MAX} onChange={(e) => setPosition(e.target.value)} />
        </FormRow>
      </form>
    </Modal>
  );
}
