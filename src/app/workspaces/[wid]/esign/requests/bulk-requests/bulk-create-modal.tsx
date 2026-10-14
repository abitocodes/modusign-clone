"use client";

import { CircleCheck, CircleX, Send } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { RequestTypeChip } from "@/components/templates/parts";
import { TemplatePicker } from "@/components/templates/template-picker";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/controls";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { BULK_TITLE_MAX, singleRoleIssue, type BulkSummary, type TemplateOption } from "@/lib/templates/model";
import { cn } from "@/lib/utils";

import { createBulkSend } from "./actions";
import { checkRecipients, draftKey, RecipientsEditor, type RecipientDraft } from "./recipients-editor";

type Step = "template" | "recipients" | "confirm" | "progress";

const STEPS: { key: Exclude<Step, "progress">; label: string }[] = [
  { key: "template", label: "템플릿 선택" },
  { key: "recipients", label: "수신자 입력" },
  { key: "confirm", label: "확인" },
];

function Stepper({ step }: { step: Step }) {
  const current = step === "progress" ? 3 : STEPS.findIndex((s) => s.key === step);
  return (
    <ol className="flex items-center gap-2 text-[13px]" aria-label="진행 단계">
      {STEPS.map((s, i) => (
        <li key={s.key} className="flex items-center gap-2" aria-current={i === current ? "step" : undefined}>
          {i > 0 && <span className="h-px w-6 bg-line-strong" aria-hidden />}
          <span
            className={cn(
              "flex size-5 items-center justify-center rounded-full text-[11px] font-bold",
              i < current ? "bg-positive text-fg-reversed" : i === current ? "bg-fg text-fg-reversed" : "bg-btn-dark text-fg-muted",
            )}
          >
            {i + 1}
          </span>
          <span className={cn(i === current ? "font-bold text-fg" : "text-fg-muted")}>{s.label}</span>
        </li>
      ))}
    </ol>
  );
}

/** 템플릿으로 대량전송: template → recipients (manual / CSV) → confirm → progress. */
export function BulkCreateModal({
  wid,
  templates,
  progress,
  onClose,
  onCreated,
  onOpenDetail,
}: {
  wid: string;
  templates: TemplateOption[];
  /** live summary of the batch created by this dialog */
  progress: { id: string; summary: BulkSummary; error: string | null } | null;
  onClose: () => void;
  onCreated: (id: string, total: number, title: string) => void;
  onOpenDetail: (id: string) => void;
}) {
  const [step, setStep] = useState<Step>("template");
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [rows, setRows] = useState<RecipientDraft[]>(() => [{ key: draftKey(), name: "", email: "" }]);
  const [pending, startTransition] = useTransition();

  const template = templates.find((t) => t.id === templateId) ?? null;
  const check = useMemo(() => checkRecipients(rows), [rows]);
  const titleOk = title.trim().length > 0 && title.trim().length <= BULK_TITLE_MAX;

  const pickTemplate = (id: string) => {
    const t = templates.find((x) => x.id === id);
    if (!t || singleRoleIssue(t)) return;
    // keep a custom title when switching templates
    if (!title.trim() || title === template?.title) setTitle(t.title.slice(0, BULK_TITLE_MAX));
    setTemplateId(id);
  };

  const submit = () => {
    if (!template || !check.valid || !titleOk || pending) return;
    startTransition(async () => {
      try {
        const res = await createBulkSend(wid, {
          templateId: template.id,
          title: title.trim(),
          recipients: check.filled.map((r) => ({ name: r.name, email: r.email })),
        });
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        setStep("progress");
        onCreated(res.id, res.total, title.trim());
      } catch {
        toast.error("대량전송을 시작하지 못했습니다. 네트워크 상태를 확인해 주세요.");
      }
    });
  };

  const summary = progress?.summary ?? null;
  const done = !!summary && summary.status !== "sending";
  const processed = summary ? summary.sent + summary.failed : 0;

  const close = () => {
    if (step === "progress" && !done && !progress?.error) toast("대량전송은 이 페이지에서 계속 진행됩니다.");
    onClose();
  };

  const footer =
    step === "template" ? (
      <>
        <Button variant="light" onClick={close}>
          취소
        </Button>
        <Button variant="primary" disabled={!template} onClick={() => setStep("recipients")}>
          다음
        </Button>
      </>
    ) : step === "recipients" ? (
      <>
        <Button variant="light" onClick={() => setStep("template")}>
          이전
        </Button>
        <Button variant="primary" disabled={!check.valid || !titleOk} onClick={() => setStep("confirm")}>
          다음
        </Button>
      </>
    ) : step === "confirm" ? (
      <>
        <Button variant="light" onClick={() => setStep("recipients")} disabled={pending}>
          이전
        </Button>
        <Button variant="primary" icon={<Send className="size-4" />} onClick={submit} disabled={pending}>
          {pending ? "준비 중…" : `${check.filled.length}명에게 전송하기`}
        </Button>
      </>
    ) : (
      <>
        {done && progress && (
          <Button variant="light" onClick={() => onOpenDetail(progress.id)}>
            상세 보기
          </Button>
        )}
        <Button variant={done ? "primary" : "light"} onClick={close}>
          {done ? "확인" : "닫기"}
        </Button>
      </>
    );

  return (
    <Modal open onClose={close} width={760} title="템플릿으로 대량전송" icon={<Send />} footerBar footer={footer} closeOnBackdrop={false}>
      <div className="px-[30px] pb-6 pt-5">
        <Stepper step={step} />

        {step === "template" && (
          <div className="mt-5">
            <p className="mb-3 text-[13px] text-fg-2">대량전송할 템플릿을 선택하세요. 수신자마다 이 템플릿으로 문서가 하나씩 만들어져 서명 요청이 전송됩니다.</p>
            <TemplatePicker wid={wid} templates={templates} value={templateId} onChange={pickTemplate} purpose="대량전송" />
          </div>
        )}

        {step === "recipients" && template && (
          <div className="mt-5">
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium text-fg-muted">대량전송 제목</span>
              <Input
                value={title}
                maxLength={BULK_TITLE_MAX}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="대량전송 제목"
                invalid={!titleOk}
                className="h-10"
              />
              <span className="mt-1 block text-xs text-fg-faint">수신자에게 보내는 문서의 제목으로도 사용됩니다. ({title.trim().length}/{BULK_TITLE_MAX})</span>
            </label>
            <p className="mb-2 mt-5 text-[13px] font-medium text-fg-muted">
              수신자 <span className="font-normal">· 역할 &lsquo;{template.roleName}&rsquo;에 입력됩니다.</span>
            </p>
            <RecipientsEditor rows={rows} onChange={setRows} />
          </div>
        )}

        {step === "confirm" && template && (
          <div className="mt-5 space-y-4">
            <div className="rounded-md border border-line-strong bg-surface-3">
              <dl className="divide-y divide-line-light text-[13px]">
                <div className="flex gap-4 px-[18px] py-3">
                  <dt className="w-24 shrink-0 font-bold text-fg-2">템플릿</dt>
                  <dd className="flex min-w-0 items-center gap-1.5 text-fg">
                    <span className="truncate">{template.title}</span>
                    <RequestTypeChip type={template.requestType} className="h-[18px] px-1.5 text-[11px]" />
                  </dd>
                </div>
                <div className="flex gap-4 px-[18px] py-3">
                  <dt className="w-24 shrink-0 font-bold text-fg-2">대량전송 제목</dt>
                  <dd className="min-w-0 truncate text-fg">{title.trim()}</dd>
                </div>
                <div className="flex gap-4 px-[18px] py-3">
                  <dt className="w-24 shrink-0 font-bold text-fg-2">수신자</dt>
                  <dd className="text-fg">총 {check.filled.length}명 (문서 {check.filled.length}건 전송)</dd>
                </div>
              </dl>
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-bold text-fg">아래 수신자에게 서명 요청을 보냅니다.</p>
                <p className="text-xs text-fg-muted">총 {check.filled.length}명</p>
              </div>
              <ul className="max-h-[220px] overflow-y-auto rounded border border-line-strong bg-surface-3">
                {check.filled.map((r) => (
                  <li key={r.key} className="flex h-11 items-center justify-between gap-4 border-b border-line-light px-[18px] last:border-b-0">
                    <span className="truncate text-[13px] font-bold text-fg">{r.name.trim()}</span>
                    <span className="truncate text-[13px] text-fg-2">{r.email.trim().toLowerCase()}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {step === "progress" && (
          <div className="mt-8 pb-4 text-center" role="status" aria-live="polite">
            {progress?.error ? (
              <>
                <CircleX className="mx-auto size-11 text-negative" strokeWidth={1.8} />
                <p className="mt-3 text-lg font-bold text-fg">전송이 중단되었습니다</p>
                <p className="mt-1 text-[13px] text-fg-2">{progress.error}</p>
                <p className="mt-1 text-[13px] text-fg-muted">목록의 추가 메뉴에서 &lsquo;이어서 전송&rsquo;을 눌러 남은 수신자에게 전송할 수 있습니다.</p>
              </>
            ) : done && summary ? (
              <>
                {summary.sent > 0 ? (
                  <CircleCheck className="mx-auto size-11 text-positive" strokeWidth={1.8} />
                ) : (
                  <CircleX className="mx-auto size-11 text-negative" strokeWidth={1.8} />
                )}
                <p className="mt-3 text-lg font-bold text-fg">{summary.sent > 0 ? "대량전송을 완료했습니다" : "대량전송에 실패했습니다"}</p>
                <p className="mt-1 text-[13px] text-fg-2">
                  전송 완료 {summary.sent}건{summary.failed > 0 && <span className="text-negative"> · 실패 {summary.failed}건</span>}
                </p>
              </>
            ) : (
              <>
                <p className="text-lg font-bold text-fg">서명 요청을 보내는 중입니다</p>
                <p className="mt-1 text-[13px] text-fg-muted">창을 닫아도 이 페이지에 머무르는 동안 전송이 계속됩니다.</p>
                <div className="mx-auto mt-6 max-w-[420px]">
                  <ProgressBar value={processed} max={summary?.total || check.filled.length || 1} className="h-2 bg-btn-dark [&>div]:bg-positive" />
                  <p className="mt-2 text-[13px] text-fg-2">
                    {processed} / {summary?.total ?? check.filled.length}
                    {summary && summary.failed > 0 && <span className="ml-2 text-negative">실패 {summary.failed}건</span>}
                  </p>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
