"use client";

import { Check, Copy, ExternalLink, Link2, Plus } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { createTemplateLabel } from "@/app/workspaces/[wid]/templates/actions";
import { copyText, RequestTypeChip } from "@/components/templates/parts";
import { TemplatePicker } from "@/components/templates/template-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { LINK_TITLE_MAX, singleRoleIssue, type TemplateOption } from "@/lib/templates/model";
import type { Label } from "@/lib/types";
import { cn, PARTICIPANT_COLORS } from "@/lib/utils";

import { createLinkSign } from "./actions";

/** URL box with 복사 / 열기 buttons. */
export function LinkUrlBox({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (await copyText(url)) {
      setCopied(true);
      toast.success("링크를 복사했습니다.");
      setTimeout(() => setCopied(false), 1800);
    } else toast.error("링크를 복사하지 못했습니다. 직접 선택해 복사해 주세요.");
  };
  return (
    <div className="flex gap-2">
      <Input readOnly value={url} aria-label="링크 주소" className="h-10 font-mono text-[13px]" onFocus={(e) => e.currentTarget.select()} />
      <Button variant="neutral" className="h-10" icon={copied ? <Check className="size-4" /> : <Copy className="size-4" />} onClick={copy}>
        {copied ? "복사됨" : "복사"}
      </Button>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="새 탭에서 열기"
        title="새 탭에서 열기"
        className="inline-flex size-10 shrink-0 items-center justify-center rounded border border-line-strong bg-btn-light text-icon-2 hover:bg-btn-base"
      >
        <ExternalLink className="size-4" />
      </a>
    </div>
  );
}

/** Row click → share the link. */
export function LinkShareModal({ title, url, active, onClose }: { title: string; url: string; active: boolean; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} width={560} title="링크 공유" icon={<Link2 />} footer={<Button variant="primary" onClick={onClose}>확인</Button>}>
      <div className="px-[30px] pb-2 pt-6">
        <p className="truncate text-[15px] font-bold text-fg">{title}</p>
        <p className="mb-4 mt-1 text-[13px] text-fg-muted">
          링크를 받은 사람은 로그인 없이 이름과 이메일을 입력하고 서명할 수 있습니다. 서명할 때마다 새 문서가 만들어집니다.
        </p>
        <LinkUrlBox url={url} />
        {!active && <p className="mt-3 text-[13px] text-warning">비활성 상태의 링크입니다. 활성화하기 전에는 서명을 받을 수 없습니다.</p>}
      </div>
    </Modal>
  );
}

/** + 링크서명 시작: template → title / labels → created (link to copy). */
export function LinkCreateModal({
  wid,
  templates,
  labels: initialLabels,
  onClose,
}: {
  wid: string;
  templates: TemplateOption[];
  labels: Label[];
  onClose: () => void;
}) {
  const [step, setStep] = useState<"template" | "details" | "done">("template");
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [labels, setLabels] = useState(initialLabels);
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const [newLabel, setNewLabel] = useState("");
  const [created, setCreated] = useState<{ url: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const [creatingLabel, startLabel] = useTransition();

  const template = templates.find((t) => t.id === templateId) ?? null;
  const titleOk = title.trim().length > 0 && title.trim().length <= LINK_TITLE_MAX;

  const pick = (id: string) => {
    const t = templates.find((x) => x.id === id);
    if (!t || singleRoleIssue(t)) return;
    if (!title.trim() || title === template?.title) setTitle(t.title.slice(0, LINK_TITLE_MAX));
    setTemplateId(id);
  };

  const addLabel = () => {
    const name = newLabel.trim();
    if (!name || creatingLabel) return;
    startLabel(async () => {
      const res = await createTemplateLabel(wid, name, PARTICIPANT_COLORS[labels.length % PARTICIPANT_COLORS.length]);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setLabels((cur) => (cur.some((l) => l.id === res.label.id) ? cur : [...cur, res.label]));
      setLabelIds((cur) => (cur.includes(res.label.id) ? cur : [...cur, res.label.id]));
      setNewLabel("");
    });
  };

  const submit = () => {
    if (!template || !titleOk || pending) return;
    startTransition(async () => {
      try {
        const res = await createLinkSign(wid, { templateId: template.id, title: title.trim(), labelIds });
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        setCreated({ url: res.url });
        setStep("done");
      } catch {
        toast.error("링크서명을 만들지 못했습니다. 네트워크 상태를 확인해 주세요.");
      }
    });
  };

  const footer =
    step === "template" ? (
      <>
        <Button variant="light" onClick={onClose}>
          취소
        </Button>
        <Button variant="primary" disabled={!template} onClick={() => setStep("details")}>
          다음
        </Button>
      </>
    ) : step === "details" ? (
      <>
        <Button variant="light" onClick={() => setStep("template")} disabled={pending}>
          이전
        </Button>
        <Button variant="primary" onClick={submit} disabled={!titleOk || pending}>
          {pending ? "만드는 중…" : "링크 만들기"}
        </Button>
      </>
    ) : (
      <Button variant="primary" onClick={onClose}>
        확인
      </Button>
    );

  return (
    <Modal open onClose={() => !pending && onClose()} width={640} title="링크서명 시작" icon={<Link2 />} footerBar footer={footer} closeOnBackdrop={false}>
      <div className="px-[30px] pb-6 pt-5">
        {step === "template" && (
          <>
            <p className="mb-3 text-[13px] text-fg-2">
              링크로 서명을 받을 템플릿을 선택하세요. 링크를 연 사람이 이름과 이메일을 입력하면 이 템플릿으로 문서가 만들어집니다.
            </p>
            <TemplatePicker wid={wid} templates={templates} value={templateId} onChange={pick} purpose="링크서명" />
          </>
        )}

        {step === "details" && template && (
          <div className="space-y-5">
            <div className="flex items-center gap-2 rounded-md border border-line-light bg-surface-3 px-4 py-3 text-[13px]">
              <span className="text-fg-muted">템플릿</span>
              <span className="min-w-0 truncate font-medium text-fg">{template.title}</span>
              <RequestTypeChip type={template.requestType} className="h-[18px] shrink-0 px-1.5 text-[11px]" />
              <span className="ml-auto shrink-0 text-fg-muted">역할: {template.roleName}</span>
            </div>
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium text-fg-muted">링크 제목</span>
              <Input value={title} maxLength={LINK_TITLE_MAX} onChange={(e) => setTitle(e.target.value)} invalid={!titleOk} className="h-10" placeholder="링크 제목" />
              <span className="mt-1 block text-xs text-fg-faint">서명 페이지와 만들어지는 문서의 제목으로 사용됩니다. ({title.trim().length}/{LINK_TITLE_MAX})</span>
            </label>
            <div>
              <p className="mb-1.5 text-[13px] font-medium text-fg-muted">
                적용할 라벨 <span className="font-normal text-fg-faint">(선택)</span>
              </p>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="적용할 라벨">
                {labels.length === 0 && <span className="text-[13px] text-fg-muted">아직 만든 라벨이 없습니다.</span>}
                {labels.map((l) => {
                  const on = labelIds.includes(l.id);
                  return (
                    <button
                      key={l.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setLabelIds((cur) => (on ? cur.filter((x) => x !== l.id) : [...cur, l.id]))}
                      className={cn(
                        "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[13px] transition-colors",
                        on ? "border-emphasis bg-emphasis-bg text-fg" : "border-line-strong text-fg-2 hover:bg-surface-4",
                      )}
                    >
                      <span className="size-2 rounded-full" style={{ background: l.color }} aria-hidden />
                      {l.name}
                      {on && <Check className="size-3.5 text-emphasis" />}
                    </button>
                  );
                })}
              </div>
              <div className="mt-2.5 flex max-w-[360px] gap-2">
                <Input
                  value={newLabel}
                  maxLength={20}
                  placeholder="새 라벨 이름 (20자 이내)"
                  aria-label="새 라벨 이름"
                  className="h-8"
                  onChange={(e) => setNewLabel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      addLabel();
                    }
                  }}
                />
                <Button variant="outline" size="sm" icon={<Plus className="size-3.5" />} onClick={addLabel} disabled={!newLabel.trim() || creatingLabel}>
                  추가
                </Button>
              </div>
              <p className="mt-1.5 text-xs text-fg-faint">링크로 만들어지는 문서에 자동으로 붙습니다.</p>
            </div>
          </div>
        )}

        {step === "done" && created && (
          <div>
            <div className="flex items-center gap-2">
              <span className="flex size-7 items-center justify-center rounded-full bg-positive text-fg-reversed">
                <Check className="size-4" strokeWidth={3} />
              </span>
              <p className="text-lg font-bold text-fg">링크서명이 만들어졌습니다</p>
            </div>
            <p className="mb-4 mt-2 text-[13px] text-fg-2">아래 링크를 서명받을 사람에게 전달하세요. 목록의 추가 메뉴에서 언제든 다시 복사할 수 있습니다.</p>
            <LinkUrlBox url={created.url} />
          </div>
        )}
      </div>
    </Modal>
  );
}
