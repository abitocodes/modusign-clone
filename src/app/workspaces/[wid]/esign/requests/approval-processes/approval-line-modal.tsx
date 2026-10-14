"use client";

import { Info, ListOrdered } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { ApproverListEditor } from "@/components/tools/approver-list-editor";
import { Counter, FieldError, FormRow, FormSection, RequiredMark } from "@/components/tools/form-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { APPROVER_LIMIT, LINE_NAME_LIMIT, type ApprovalLineRecord, type MemberOption } from "@/lib/tools/approvals";

import { createApprovalLine, updateApprovalLine } from "./actions";

/** 결재선 추가 / 수정 dialog. Mount only while open. */
export function ApprovalLineModal({
  wid,
  line,
  members,
  readOnly = false,
  onClose,
}: {
  wid: string;
  line: ApprovalLineRecord | null;
  members: MemberOption[];
  readOnly?: boolean;
  onClose: () => void;
}) {
  const editing = !!line;
  const [name, setName] = useState(line?.name ?? "");
  const [ids, setIds] = useState<string[]>(line ? line.approvers.map((a) => a.user_id) : [""]);
  const [nameTouched, setNameTouched] = useState(false);
  const [pending, startTransition] = useTransition();

  const memberIds = new Set(members.map((m) => m.id));
  const savedNames = Object.fromEntries((line?.approvers ?? []).map((a) => [a.user_id, a.name]));
  const trimmed = name.trim();
  const nameError = !trimmed ? "결재선 이름을 입력해 주세요." : trimmed.length > LINE_NAME_LIMIT ? `${LINE_NAME_LIMIT}자 이내로 입력해 주세요.` : null;
  const missing = ids.some((id) => !id);
  const stale = ids.some((id) => id && !memberIds.has(id));
  const approverError =
    ids.length === 0
      ? "결재자를 한 명 이상 지정해 주세요."
      : missing
        ? "결재자를 모두 선택해 주세요."
        : stale
          ? "워크스페이스에 없는 멤버가 포함되어 있습니다. 다른 멤버로 바꿔 주세요."
          : null;
  const valid = !nameError && !approverError;

  const close = () => {
    if (!pending) onClose();
  };

  const submit = () => {
    if (!valid || pending || readOnly) return;
    startTransition(async () => {
      const input = { name: trimmed, approverIds: ids };
      const res = editing ? await updateApprovalLine(wid, line.id, input) : await createApprovalLine(wid, input);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(editing ? "결재선을 수정했습니다." : "결재선을 추가했습니다.");
      onClose();
    });
  };

  return (
    <Modal
      open
      onClose={close}
      width={672}
      icon={<ListOrdered />}
      title={readOnly ? "결재선 보기" : editing ? "결재선 수정" : "결재선 추가"}
      footer={
        readOnly ? (
          <Button variant="light" className="min-w-[60px] font-bold" onClick={close}>
            닫기
          </Button>
        ) : (
          <>
            <Button variant="light" className="min-w-[60px] font-bold" onClick={close} disabled={pending}>
              취소
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="approval-line-form"
              className="min-w-[60px] border border-transparent disabled:border-line"
              disabled={!valid || pending}
            >
              {pending ? "저장 중…" : editing ? "저장" : "추가"}
            </Button>
          </>
        )
      }
    >
      <form
        id="approval-line-form"
        noValidate
        className="px-[30px] pt-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {readOnly && (
          <p className="mt-4 flex items-center gap-2 rounded-md border border-emphasis-border bg-emphasis-bg px-3 py-2.5 text-[13px] text-fg-2">
            <Info className="size-4 shrink-0 text-emphasis" />
            다른 멤버가 만든 결재선입니다. 결재선을 만든 사람 또는 관리자만 수정할 수 있습니다.
          </p>
        )}
        <FormSection className="pt-5">
          <FormRow label="결재선 이름" required htmlFor="line-name">
            <Input
              id="line-name"
              autoFocus={!readOnly}
              disabled={readOnly}
              value={name}
              maxLength={LINE_NAME_LIMIT}
              placeholder={`${LINE_NAME_LIMIT}자 이내로 입력`}
              invalid={nameTouched && !!nameError}
              onChange={(e) => {
                setName(e.target.value);
                setNameTouched(true);
              }}
            />
            {nameTouched && nameError ? <FieldError>{nameError}</FieldError> : <Counter value={name.length} max={LINE_NAME_LIMIT} />}
          </FormRow>
        </FormSection>
        <FormSection className="pb-8">
          <p className="text-sm font-medium text-fg">
            결재자
            <RequiredMark />
            <span className="ml-1.5 text-xs font-normal text-fg-muted">결재 순서대로 지정 (최대 {APPROVER_LIMIT}명)</span>
          </p>
          <div className="mt-4">
            <ApproverListEditor
              members={members}
              value={ids}
              onChange={setIds}
              disabled={readOnly}
              invalid={stale}
              idPrefix="line-approver"
              fallbackLabels={savedNames}
            />
            {!readOnly && ids.length > 0 && stale && <FieldError>{approverError}</FieldError>}
          </div>
        </FormSection>
      </form>
    </Modal>
  );
}
