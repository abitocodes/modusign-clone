"use client";

import { TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { validateFields, type EditorCustomField, type EditorField, type EditorParticipant } from "@/components/editor/editor-model";
import { FieldEditor } from "@/components/editor/field-editor";
import { FieldPreviewModal } from "@/components/editor/field-preview-modal";
import { Button } from "@/components/ui/button";
import { WizardHeader, WizardNextButton } from "@/components/wizard/wizard-header";
import type { PageSize, RequestType } from "@/lib/types";

import { saveDocumentAsTemplate, saveDocumentFields } from "./actions";

type Busy = null | "save" | "next" | "back" | "template";

const serialize = (fields: EditorField[]) => JSON.stringify(fields);

export function Step2Client({
  workspaceId,
  documentId,
  requestType,
  documentName,
  pdfUrl: initialPdfUrl,
  pageSizes,
  participants,
  signerKeys,
  initialFields,
  customFields,
}: {
  workspaceId: string;
  documentId: string;
  requestType: RequestType;
  documentName: string;
  pdfUrl: string | null;
  pageSizes: PageSize[];
  participants: EditorParticipant[];
  /** participant ids that must receive at least one field (sign requests) */
  signerKeys: string[];
  initialFields: EditorField[];
  customFields: EditorCustomField[];
}) {
  const router = useRouter();
  // Keep the first signed URL: server refreshes after saving would otherwise reload the PDF.
  const [pdfUrl] = useState(initialPdfUrl);
  const [fields, setFields] = useState<EditorField[]>(initialFields);
  const [saved, setSaved] = useState(() => serialize(initialFields));
  const [busy, setBusy] = useState<Busy>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const current = useMemo(() => serialize(fields), [fields]);
  const dirty = current !== saved;
  const stepPath = (n: 1 | 3) => `/workspaces/${workspaceId}/documents/d/${documentId}/steps/${n}`;

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const save = async (mode: "draft" | "next") => {
    const snapshot = fields;
    try {
      const res = await saveDocumentFields({ workspaceId, documentId, mode, fields: snapshot });
      if (!res.ok) {
        toast.error(res.error);
        return false;
      }
      setSaved(serialize(snapshot));
      return true;
    } catch {
      toast.error("저장 중 오류가 발생했습니다. 네트워크 상태를 확인해 주세요.");
      return false;
    }
  };

  const onTempSave = async () => {
    if (busy) return;
    setBusy("save");
    const ok = await save("draft");
    setBusy(null);
    if (ok) toast.success("임시 저장되었습니다.");
  };

  const onSaveAsTemplate = async () => {
    if (busy) return;
    setBusy("template");
    try {
      const res = await saveDocumentAsTemplate({ workspaceId, documentId, fields });
      if (!res.ok) toast.error(res.error);
      else
        toast.success("템플릿으로 저장되었습니다.", {
          action: { label: "템플릿 보기", onClick: () => router.push(`/workspaces/${workspaceId}/esign/requests/templates`) },
        });
    } catch {
      toast.error("템플릿을 저장하지 못했습니다.");
    } finally {
      setBusy(null);
    }
  };

  const onBack = async () => {
    if (busy) return;
    if (dirty) {
      setBusy("back");
      const ok = await save("draft");
      if (!ok) {
        setBusy(null);
        return;
      }
    }
    router.push(stepPath(1));
  };

  const onNext = async () => {
    if (busy) return;
    const msg = validateFields(fields, signerKeys, { requireEverySigner: requestType === "sign" });
    if (msg) {
      toast.error(msg);
      return;
    }
    setBusy("next");
    const ok = await save("next");
    if (!ok) {
      setBusy(null);
      return;
    }
    router.push(stepPath(3));
  };

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-body-2">
      <WizardHeader
        onBack={onBack}
        onTempSave={onTempSave}
        onSaveAsTemplate={onSaveAsTemplate}
        extra={
          <Button variant="neutral" size="lg" className="px-6" disabled={!pdfUrl} onClick={() => setPreviewOpen(true)}>
            미리보기
          </Button>
        }
        primary={<WizardNextButton onClick={onNext} loading={busy === "next" || busy === "back"} disabled={!!busy || !pdfUrl} />}
      />

      {pdfUrl ? (
        <FieldEditor
          pdfUrl={pdfUrl}
          pageSizes={pageSizes}
          participants={participants}
          value={fields}
          onChange={setFields}
          customFields={customFields}
          documentName={documentName}
        />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-sm text-fg-muted">
          <TriangleAlert className="size-6 text-negative" />
          <p className="font-medium text-fg-2">문서 파일을 불러오지 못했습니다.</p>
          <p>이전 단계로 돌아가 문서를 다시 업로드해 주세요.</p>
        </div>
      )}

      {pdfUrl && (
        <FieldPreviewModal
          open={previewOpen}
          onClose={() => setPreviewOpen(false)}
          pdfUrl={pdfUrl}
          pageSizes={pageSizes}
          participants={participants}
          fields={fields}
          documentId={documentId}
        />
      )}
    </div>
  );
}
