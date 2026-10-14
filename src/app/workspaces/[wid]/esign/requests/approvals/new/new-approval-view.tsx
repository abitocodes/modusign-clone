"use client";

import { FileText, Info, RefreshCw, Upload, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { readPdfInfo, usePdfDocument } from "@/components/pdf/pdf";
import { ApproverListEditor } from "@/components/tools/approver-list-editor";
import { Counter, FieldError, RequiredMark } from "@/components/tools/form-layout";
import { UploadDocIllustration } from "@/components/tools/illustrations";
import { Spinner } from "@/components/tools/list-states";
import { PdfPages, useElementWidth } from "@/components/tools/pdf-pages";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { ConfirmModal } from "@/components/ui/modal";
import { WizardHeader, WizardNextButton } from "@/components/wizard/wizard-header";
import { BUCKET, MAX_PDF_BYTES, paths } from "@/lib/storage";
import { createClient } from "@/lib/supabase/client";
import {
  APPROVAL_MESSAGE_LIMIT,
  APPROVAL_TITLE_LIMIT,
  APPROVER_LIMIT,
  type ApprovalLineRecord,
  type MemberOption,
} from "@/lib/tools/approvals";
import { newUuid } from "@/lib/tools/result";
import { bytesLabel, cn } from "@/lib/utils";

import { submitApproval } from "../actions";

interface PickedFile {
  file: File;
  bytes: Uint8Array;
  pageCount: number;
}

type LineOption = Pick<ApprovalLineRecord, "id" | "name" | "approvers">;

/** 업로드로 기안 작성 — full-screen: PDF preview on the left, 기안 form on the right. */
export function NewApprovalView({
  wid,
  userId,
  members,
  lines,
}: {
  wid: string;
  userId: string;
  members: MemberOption[];
  lines: LineOption[];
}) {
  const router = useRouter();
  const listHref = `/workspaces/${wid}/esign/requests/approvals`;
  const fileRef = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<PickedFile | null>(null);
  const [reading, setReading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [title, setTitle] = useState("");
  const [titleTouched, setTitleTouched] = useState(false);
  const [approverIds, setApproverIds] = useState<string[]>([""]);
  const [lineId, setLineId] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);

  const pdf = usePdfDocument(picked?.bytes ?? null);
  const [viewerRef, viewerWidth] = useElementWidth<HTMLDivElement>();
  const pageWidth = Math.max(280, Math.min(816, viewerWidth));

  const trimmedTitle = title.trim();
  const titleError = !trimmedTitle ? "기안 제목을 입력해 주세요." : null;
  const approverError =
    approverIds.length === 0 ? "결재자를 한 명 이상 지정해 주세요." : approverIds.some((id) => !id) ? "결재자를 모두 선택해 주세요." : null;
  const valid = !!picked && !titleError && !approverError && message.length <= APPROVAL_MESSAGE_LIMIT;
  const dirty = !!picked || !!trimmedTitle || approverIds.some(Boolean) || !!message.trim();

  useEffect(() => {
    if (!dirty || submitting) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty, submitting]);

  const pickFile = async (f: File | undefined) => {
    if (!f || reading) return;
    if (f.type !== "application/pdf" && !/\.pdf$/i.test(f.name)) {
      toast.error("PDF 파일만 업로드할 수 있습니다.");
      return;
    }
    if (f.size > MAX_PDF_BYTES) {
      toast.error("10MB 이하의 PDF 파일만 업로드할 수 있습니다.");
      return;
    }
    setReading(true);
    try {
      const buf = await f.arrayBuffer();
      const info = await readPdfInfo(buf);
      setPicked({ file: f, bytes: new Uint8Array(buf), pageCount: info.pageCount });
      if (!trimmedTitle) setTitle(f.name.replace(/\.pdf$/i, "").slice(0, APPROVAL_TITLE_LIMIT));
    } catch {
      toast.error("PDF 파일을 읽을 수 없습니다. 암호가 걸려 있거나 손상된 파일인지 확인해 주세요.");
    } finally {
      setReading(false);
    }
  };

  const applyLine = (id: string) => {
    setLineId(id);
    const line = lines.find((l) => l.id === id);
    if (!line) return;
    const memberIds = new Set(members.map((m) => m.id));
    const ids = Array.from(new Set(line.approvers.map((a) => a.user_id))).filter((uid) => uid !== userId && memberIds.has(uid));
    const removed = line.approvers.length - ids.length;
    setApproverIds(ids.length > 0 ? ids.slice(0, APPROVER_LIMIT) : [""]);
    if (removed > 0) toast(`기안자 본인 또는 워크스페이스에 없는 멤버 ${removed}명은 결재자에서 제외했습니다.`);
  };

  const leave = () => {
    if (dirty && !submitting) setLeaveOpen(true);
    else router.push(listHref);
  };

  const submit = async () => {
    setTitleTouched(true);
    if (!valid || !picked || submitting) return;
    setSubmitting(true);
    const id = newUuid();
    const path = paths.approval(wid, id);
    const supabase = createClient();
    let uploaded = false;
    try {
      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(path, picked.file, { contentType: "application/pdf", upsert: false });
      if (uploadError) throw new Error("upload");
      uploaded = true;
      const res = await submitApproval(wid, {
        id,
        title: trimmedTitle,
        fileName: picked.file.name,
        pageCount: picked.pageCount,
        message: message.trim(),
        approverIds,
        lineId: lineId || null,
      });
      if (!res.ok) {
        await supabase.storage.from(BUCKET).remove([path]);
        toast.error(res.error);
        setSubmitting(false);
        return;
      }
      toast.success("결재를 요청했습니다. 첫 번째 결재자에게 알림을 보냈습니다.");
      router.replace(`${listHref}/${res.id}`);
    } catch {
      // network failure / server action crash: remove the orphan upload and let the user retry
      if (uploaded) await supabase.storage.from(BUCKET).remove([path]).catch(() => undefined);
      toast.error(
        uploaded ? "결재를 요청하지 못했습니다. 잠시 후 다시 시도해 주세요." : "파일을 업로드하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      );
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-body">
      <WizardHeader
        backLabel="나가기"
        onBack={leave}
        primary={
          <WizardNextButton disabled={!valid} loading={submitting} onClick={submit}>
            결재 요청
          </WizardNextButton>
        }
      />

      <div className="flex min-h-0 flex-1">
        {/* ---------------------------------------------------------- PDF */}
        <section
          className={cn("relative min-w-0 flex-1 overflow-y-auto bg-body-2 px-8 py-8", dragOver && "bg-emphasis-bg/30")}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={(e) => {
            if (e.currentTarget === e.target) setDragOver(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            void pickFile(e.dataTransfer.files?.[0]);
          }}
        >
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(e) => {
              void pickFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <div ref={viewerRef} className="mx-auto w-full max-w-[816px]">
            {!picked ? (
              <div
                className={cn(
                  "mx-auto mt-[6vh] flex max-w-[560px] flex-col items-center rounded-xl border-2 border-dashed border-line-strong bg-surface px-10 py-12 text-center",
                  dragOver && "border-emphasis",
                )}
              >
                {reading ? (
                  <div className="flex h-[188px] flex-col items-center justify-center gap-3">
                    <Spinner />
                    <p className="text-sm text-fg-muted">PDF 파일을 확인하는 중입니다…</p>
                  </div>
                ) : (
                  <>
                    <UploadDocIllustration className="h-[120px] w-40 text-fg" />
                    <p className="mt-5 text-lg font-bold text-fg">결재 받을 PDF 문서를 올려 주세요</p>
                    <p className="mt-2 text-sm text-fg-muted">파일을 이 영역에 끌어다 놓거나 아래 버튼을 눌러 선택하세요.</p>
                    <Button variant="primary" size="lg" className="mt-6" icon={<Upload className="size-[18px]" />} onClick={() => fileRef.current?.click()}>
                      파일 선택
                    </Button>
                    <p className="mt-3 text-xs text-fg-faint">PDF · 최대 10MB</p>
                  </>
                )}
              </div>
            ) : (
              <>
                <div className="mb-5 flex items-center gap-3 rounded-lg border border-line-light bg-surface px-4 py-3">
                  <FileText className="size-5 shrink-0 text-negative" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-fg">{picked.file.name}</p>
                    <p className="text-xs text-fg-muted">
                      {bytesLabel(picked.file.size)} · {picked.pageCount}페이지
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    icon={<RefreshCw className="size-3.5" />}
                    disabled={submitting || reading}
                    onClick={() => fileRef.current?.click()}
                  >
                    파일 변경
                  </Button>
                  <button
                    type="button"
                    aria-label="파일 삭제"
                    disabled={submitting}
                    onClick={() => setPicked(null)}
                    className="flex size-8 items-center justify-center rounded text-fg-faint hover:bg-btn-light hover:text-fg-2 disabled:opacity-40"
                  >
                    <X className="size-4" />
                  </button>
                </div>
                {pdf.error ? (
                  <p className="py-20 text-center text-sm text-negative">미리보기를 불러오지 못했습니다.</p>
                ) : !pdf.doc ? (
                  <div className="flex justify-center py-24">
                    <Spinner />
                  </div>
                ) : (
                  <PdfPages doc={pdf.doc} pageSizes={pdf.pageSizes} width={pageWidth} />
                )}
              </>
            )}
          </div>
        </section>

        {/* --------------------------------------------------------- form */}
        <aside className="w-[420px] shrink-0 overflow-y-auto border-l border-line bg-modal px-6 pb-10 pt-7">
          <h1 className="text-lg font-bold text-fg">업로드로 기안 작성</h1>
          <p className="mt-1 text-[13px] text-fg-muted">PDF 문서를 올리고 결재자를 순서대로 지정하세요.</p>

          <div className="mt-6 border-t border-line pt-5">
            <label htmlFor="approval-title" className="text-sm font-medium text-fg">
              기안 제목
              <RequiredMark />
            </label>
            <Input
              id="approval-title"
              className="mt-2"
              value={title}
              maxLength={APPROVAL_TITLE_LIMIT}
              placeholder="기안 제목을 입력하세요"
              invalid={titleTouched && !!titleError}
              onChange={(e) => {
                setTitle(e.target.value);
                setTitleTouched(true);
              }}
            />
            {titleTouched && titleError ? <FieldError>{titleError}</FieldError> : <Counter value={title.length} max={APPROVAL_TITLE_LIMIT} />}
          </div>

          <div className="mt-5 border-t border-line pt-5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-fg">
                결재자
                <RequiredMark />
                <span className="ml-1.5 text-xs font-normal text-fg-muted">결재 순서대로 (최대 {APPROVER_LIMIT}명)</span>
              </p>
            </div>
            {lines.length > 0 && (
              <Select
                aria-label="결재선 불러오기"
                value={lineId}
                onChange={(e) => applyLine(e.target.value)}
                wrapperClassName="mt-3 w-full"
              >
                <option value="">결재선 불러오기 (선택)</option>
                {lines.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} · {l.approvers.length}명
                  </option>
                ))}
              </Select>
            )}
            <div className="mt-3">
              <ApproverListEditor
                members={members}
                value={approverIds}
                onChange={setApproverIds}
                excludeIds={[userId]}
                disabled={submitting}
                idPrefix="draft-approver"
              />
            </div>
          </div>

          <div className="mt-5 border-t border-line pt-5">
            <label htmlFor="approval-message" className="text-sm font-medium text-fg">
              기안 의견 <span className="text-xs font-normal text-fg-muted">(선택)</span>
            </label>
            <Textarea
              id="approval-message"
              className="mt-2 h-[120px]"
              value={message}
              maxLength={APPROVAL_MESSAGE_LIMIT}
              placeholder="결재자에게 전달할 내용을 입력하세요"
              onChange={(e) => setMessage(e.target.value)}
            />
            <Counter value={message.length} max={APPROVAL_MESSAGE_LIMIT} />
          </div>

          <p className="mt-5 flex gap-2 rounded-md border border-emphasis-border bg-emphasis-bg px-3 py-2.5 text-[13px] leading-relaxed text-fg-2">
            <Info className="mt-0.5 size-4 shrink-0 text-emphasis" />
            <span>결재는 지정한 순서대로 진행됩니다. 결재를 요청하면 첫 번째 결재자에게 이메일 알림이 전송됩니다.</span>
          </p>
          {!picked && <p className="mt-3 text-xs text-fg-muted">PDF 문서를 올리면 결재를 요청할 수 있습니다.</p>}
          {picked && approverError && approverIds.length > 0 && approverIds.some(Boolean) && (
            <p className="mt-3 text-xs text-fg-muted">{approverError}</p>
          )}
        </aside>
      </div>

      <ConfirmModal
        open={leaveOpen}
        onClose={() => setLeaveOpen(false)}
        onConfirm={() => router.push(listHref)}
        title="기안 작성을 그만둘까요?"
        description="작성 중인 내용은 저장되지 않습니다."
        confirmLabel="나가기"
        cancelLabel="계속 작성"
        danger
      />
    </div>
  );
}
