"use client";

import { Info, PencilLine, Trash2, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { deleteWorkspace, renameWorkspace, transferOwnership } from "@/app/workspaces/[wid]/settings/workspace/info/actions";
import { useWorkspace } from "@/components/shell/workspace-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";

import { MemberPicker } from "./member-picker";
import { isAdminRole, NAME_MAX, type SettingsMember } from "./shared";
import { CardTitle, Divider, InfoRow, SettingsCard, TextButton } from "./ui";

export function WorkspaceInfo({
  members,
  owner,
  isCompany,
  personalWorkspaceId,
}: {
  members: SettingsMember[];
  owner: SettingsMember | null;
  isCompany: boolean;
  personalWorkspaceId: string | null;
}) {
  const { workspace, role, profile } = useWorkspace();
  const router = useRouter();
  const [renameOpen, setRenameOpen] = useState(false);
  const [ownerOpen, setOwnerOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const canEdit = isAdminRole(role);
  const canTransfer = role === "owner" && workspace.type === "team";
  const isPersonal = workspace.type === "personal";

  const onDeleteClick = () => {
    if (isCompany) return toast.error("회사 워크스페이스는 삭제할 수 없습니다.");
    if (isPersonal) return toast.error("개인 워크스페이스는 삭제할 수 없습니다.");
    if (role !== "owner") return toast.error("최고 관리자만 워크스페이스를 삭제할 수 있습니다.");
    setDeleteOpen(true);
  };

  return (
    <SettingsCard>
      <CardTitle title="기본 정보" />
      <dl className="mt-2.5">
        <InfoRow label="종류">{isPersonal ? "개인 워크스페이스" : "공용 워크스페이스"}</InfoRow>
        <InfoRow label="이름">
          <span className="font-medium">{workspace.name}</span>
          {canEdit && <TextButton onClick={() => setRenameOpen(true)}>변경</TextButton>}
        </InfoRow>
        <InfoRow
          label={
            <>
              최고 관리자
              <span
                className="inline-flex text-fg-muted"
                title="최고 관리자는 워크스페이스의 모든 설정과 멤버를 관리할 수 있습니다."
                aria-label="최고 관리자는 워크스페이스의 모든 설정과 멤버를 관리할 수 있습니다."
              >
                <Info className="size-3.5" />
              </span>
            </>
          }
        >
          {owner ? (
            <span>
              <span className="font-medium">{owner.name}</span>
              <span className="text-[13px] text-fg-faint">({owner.email})</span>
            </span>
          ) : (
            <span className="text-fg-muted">-</span>
          )}
          {canTransfer && (
            <Button variant="outline" size="xs" className="ml-2.5 px-4" onClick={() => setOwnerOpen(true)}>
              변경
            </Button>
          )}
        </InfoRow>
      </dl>

      <Divider className="mt-6" />

      <div className="mt-[30px] flex items-center justify-between gap-4">
        {personalWorkspaceId ? (
          <Link
            href={`/workspaces/${personalWorkspaceId}/esign/home`}
            className="inline-flex h-[42px] items-center gap-1.5 rounded-md border border-line-strong bg-btn-light px-6 text-base font-medium text-fg-2 hover:bg-btn-base"
          >
            <UserRound className="size-[17px]" />내 워크스페이스로 가기
          </Link>
        ) : (
          <span />
        )}
        <TextButton onClick={onDeleteClick} className="text-[13px]" aria-disabled={isCompany || isPersonal}>
          <Trash2 className="size-4 no-underline" />
          워크스페이스 삭제
        </TextButton>
      </div>

      {renameOpen && (
        <RenameDialog
          initial={workspace.name}
          onClose={() => setRenameOpen(false)}
          onSubmit={(name) =>
            startTransition(async () => {
              const r = await renameWorkspace(workspace.id, name);
              if (!r.ok) return void toast.error(r.error);
              toast.success("워크스페이스 이름을 변경했습니다.");
              setRenameOpen(false);
            })
          }
          pending={pending}
        />
      )}

      <MemberPicker
        open={ownerOpen}
        onClose={() => setOwnerOpen(false)}
        title="최고 관리자 변경"
        description={
          owner?.id === profile.id
            ? "새 최고 관리자를 선택해 주세요. 변경 후 회원님의 역할은 관리자로 변경됩니다."
            : "새 최고 관리자를 선택해 주세요. 기존 최고 관리자의 역할은 관리자로 변경됩니다."
        }
        members={members}
        excludeIds={owner ? [owner.id] : []}
        mode="single"
        confirmLabel="변경"
        pending={pending}
        onConfirm={([id]) =>
          startTransition(async () => {
            const r = await transferOwnership(workspace.id, id);
            if (!r.ok) return void toast.error(r.error);
            toast.success("최고 관리자를 변경했습니다.");
            setOwnerOpen(false);
          })
        }
      />

      {deleteOpen && (
        <DeleteWorkspaceDialog
          name={workspace.name}
          pending={pending}
          onClose={() => setDeleteOpen(false)}
          onConfirm={(confirmName) =>
            startTransition(async () => {
              const r = await deleteWorkspace(workspace.id, confirmName);
              if (!r.ok) return void toast.error(r.error);
              toast.success("워크스페이스를 삭제했습니다.");
              router.replace(r.data.redirectTo);
            })
          }
        />
      )}
    </SettingsCard>
  );
}

function RenameDialog({
  initial,
  onClose,
  onSubmit,
  pending,
}: {
  initial: string;
  onClose: () => void;
  onSubmit: (name: string) => void;
  pending: boolean;
}) {
  const [name, setName] = useState(initial);
  const trimmed = name.trim();
  const valid = trimmed.length > 0 && trimmed.length <= NAME_MAX && trimmed !== initial;
  return (
    <Modal
      open
      onClose={onClose}
      title="워크스페이스 이름 변경"
      icon={<PencilLine />}
      width={480}
      footer={
        <>
          <Button variant="light" onClick={onClose}>
            취소
          </Button>
          <Button variant="primary" type="submit" form="ws-rename" disabled={!valid || pending}>
            {pending ? "변경 중…" : "변경"}
          </Button>
        </>
      }
    >
      <form
        id="ws-rename"
        className="px-[30px] pb-2 pt-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid && !pending) onSubmit(trimmed);
        }}
      >
        <label htmlFor="ws-name" className="mb-2 block text-sm font-medium text-fg">
          워크스페이스 이름
        </label>
        <Input
          id="ws-name"
          value={name}
          maxLength={NAME_MAX}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          placeholder={`${NAME_MAX}자 이내로 입력`}
        />
        <p className="mt-1.5 text-right text-[11px] text-fg-muted">
          {name.length}/{NAME_MAX}
        </p>
      </form>
    </Modal>
  );
}

function DeleteWorkspaceDialog({
  name,
  pending,
  onClose,
  onConfirm,
}: {
  name: string;
  pending: boolean;
  onClose: () => void;
  onConfirm: (confirmName: string) => void;
}) {
  const [typed, setTyped] = useState("");
  return (
    <Modal
      open
      onClose={onClose}
      title="워크스페이스 삭제"
      icon={<Trash2 />}
      width={480}
      footer={
        <>
          <Button variant="light" onClick={onClose}>
            취소
          </Button>
          <Button variant="danger" disabled={typed.trim() !== name || pending} onClick={() => onConfirm(typed.trim())}>
            {pending ? "삭제 중…" : "삭제"}
          </Button>
        </>
      }
    >
      <div className="px-[30px] pb-2 pt-6 text-sm leading-relaxed text-fg-2">
        <p>
          워크스페이스를 삭제하면 문서, 템플릿, 멤버 정보가 모두 삭제되며 <b className="text-negative">복구할 수 없습니다.</b>
        </p>
        <p className="mt-4 text-[13px] text-fg-muted">
          확인을 위해 워크스페이스 이름 <b className="text-fg">{name}</b>을(를) 입력해 주세요.
        </p>
        <Input className="mt-2" value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="워크스페이스 이름 확인" autoFocus />
      </div>
    </Modal>
  );
}
