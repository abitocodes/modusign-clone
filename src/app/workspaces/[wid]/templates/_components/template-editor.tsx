"use client";

import { TriangleAlert, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { mergePrepared, prepareFile, UploadError, type PreparedFile } from "@/app/workspaces/[wid]/documents/d/upload/pdf-utils";
import { clampToPage, type EditorCustomField, type EditorField, type EditorParticipant } from "@/components/editor/editor-model";
import { FieldEditor } from "@/components/editor/field-editor";
import { FieldPreviewModal } from "@/components/editor/field-preview-modal";
import { LabelPickerModal } from "@/components/templates/label-picker-modal";
import { Button } from "@/components/ui/button";
import { ConfirmModal, Modal } from "@/components/ui/modal";
import { WizardHeader, WizardNextButton } from "@/components/wizard/wizard-header";
import { BUCKET, paths } from "@/lib/storage";
import { createClient } from "@/lib/supabase/client";
import {
  MAX_ROLES,
  defaultRoleName,
  isDefaultRoleName,
  parseRoles,
  templateFieldsError,
  type RoleDraft,
  type TemplatePayload,
} from "@/lib/templates/model";
import type { Label, PageSize, RequestType, SigningOrder } from "@/lib/types";

import { attachTemplateFile, createTemplate, createTemplateLabel, discardTemplate, updateTemplate } from "../actions";
import { InfoStep } from "./info-step";
import { RolesStep } from "./roles-step";
import { UploadStep, type CurrentDocument } from "./upload-step";

type Step = "upload" | "roles" | "fields" | "info";
const MAX_FILES = 20;

export interface TemplateEditorInitial {
  title: string;
  requestType: RequestType;
  signingOrder: SigningOrder;
  roles: RoleDraft[];
  fields: EditorField[];
  labelIds: string[];
  shared: boolean;
  /** edit mode: the stored document */
  document: { url: string; name: string; pageSizes: PageSize[] } | null;
}

/** The document the editor works on: the stored file (bytes null) or a new upload. */
interface Source {
  url: string;
  name: string;
  pageSizes: PageSize[];
  bytes: Uint8Array | null;
}

function newKey() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return `role_${c.randomUUID()}`;
  return `role_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function snapshot(v: {
  title: string;
  requestType: RequestType;
  signingOrder: SigningOrder;
  roles: RoleDraft[];
  fields: EditorField[];
  labelIds: string[];
  shared: boolean;
  fileChanged: boolean;
}) {
  // field ids are regenerated per editing session → compare everything but the id
  return JSON.stringify({ ...v, fields: v.fields.map((f) => [f.participantKey, f.type, f.page, f.x, f.y, f.width, f.height, f.required, f.options]) });
}

/** Renumbers "서명자 N" / "열람자 N" names so they follow the position and request type. */
function renumber(roles: RoleDraft[], type: RequestType) {
  return roles.map((r, i) => (isDefaultRoleName(r.name) ? { ...r, name: defaultRoleName(type, i) } : r));
}

function ExitModal({ open, mode, onClose, onExit }: { open: boolean; mode: "new" | "edit"; onClose: () => void; onExit: () => void }) {
  return (
    <Modal open={open} onClose={onClose} width={414}>
      <div className="relative p-9 text-center">
        <button type="button" aria-label="닫기" onClick={onClose} className="absolute right-4 top-4 flex size-8 items-center justify-center rounded text-icon-2 hover:bg-btn-light">
          <X className="size-5" />
        </button>
        <h2 className="text-xl font-bold text-fg">{mode === "new" ? "템플릿 등록을 그만둘까요?" : "템플릿 수정을 그만둘까요?"}</h2>
        <p className="mt-3 text-[13px] font-medium leading-relaxed text-fg-2">저장하지 않은 내용은 사라집니다.</p>
        <div className="mt-6 space-y-2">
          <button type="button" onClick={onClose} className="h-10 w-full rounded-md bg-primary text-sm font-semibold text-primary-fg hover:bg-primary-hover">
            계속 작성
          </button>
          <button type="button" onClick={onExit} className="h-10 w-full rounded-md bg-btn-dark text-sm font-semibold text-fg-2 hover:bg-btn-hover">
            저장하지 않고 나가기
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function TemplateEditor({
  wid,
  mode,
  templateId,
  initial,
  labels: initialLabels,
  customFields,
  canShare,
}: {
  wid: string;
  mode: "new" | "edit";
  templateId?: string;
  initial: TemplateEditorInitial;
  labels: Label[];
  customFields: EditorCustomField[];
  canShare: boolean;
}) {
  const router = useRouter();
  const listHref = `/workspaces/${wid}/esign/requests/templates`;

  const [step, setStep] = useState<Step>(mode === "edit" && initial.document ? "roles" : "upload");
  const [files, setFiles] = useState<PreparedFile[]>([]);
  const [preparing, setPreparing] = useState(0);
  const [filesDirty, setFilesDirty] = useState(false);
  const [keepCurrent, setKeepCurrent] = useState(!!initial.document);
  const [source, setSource] = useState<Source | null>(() =>
    initial.document ? { url: initial.document.url, name: initial.document.name, pageSizes: initial.document.pageSizes, bytes: null } : null,
  );

  const [requestType, setRequestType] = useState<RequestType>(initial.requestType);
  const [signingOrder, setSigningOrder] = useState<SigningOrder>(initial.signingOrder);
  const [roles, setRoles] = useState<RoleDraft[]>(() =>
    initial.roles.length ? initial.roles : [{ key: newKey(), name: defaultRoleName(initial.requestType, 0) }],
  );
  const [fields, setFields] = useState<EditorField[]>(initial.fields);
  const [title, setTitle] = useState(initial.title);
  const [labelIds, setLabelIds] = useState<string[]>(initial.labelIds);
  const [labels, setLabels] = useState<Label[]>(initialLabels);
  const [shared, setShared] = useState(initial.shared);

  const [busy, setBusy] = useState<null | "merge" | "save">(null);
  const [exitOpen, setExitOpen] = useState(false);
  const [labelOpen, setLabelOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [deleteRole, setDeleteRole] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);

  const blobUrl = useRef<string | null>(null);
  useEffect(
    () => () => {
      if (blobUrl.current) URL.revokeObjectURL(blobUrl.current);
    },
    [],
  );

  const initialSnapshot = useMemo(
    () =>
      snapshot({
        title: initial.title,
        requestType: initial.requestType,
        signingOrder: initial.signingOrder,
        roles: initial.roles,
        fields: initial.fields,
        labelIds: initial.labelIds,
        shared: initial.shared,
        fileChanged: false,
      }),
    [initial],
  );
  const fileChanged = !!source?.bytes || files.length > 0 || (mode === "edit" && !keepCurrent);
  const dirty =
    mode === "new"
      ? files.length > 0 || !!source
      : snapshot({ title, requestType, signingOrder, roles, fields, labelIds, shared, fileChanged }) !== initialSnapshot;

  useEffect(() => {
    if (!dirty || saved) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty, saved]);

  const fieldCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const f of fields) m[f.participantKey] = (m[f.participantKey] ?? 0) + 1;
    return m;
  }, [fields]);

  const participants: EditorParticipant[] = useMemo(
    () => roles.map((r, i) => ({ key: r.key, name: r.name.trim() || defaultRoleName(requestType, i), colorIndex: i })),
    [roles, requestType],
  );

  const documentName = source?.name ?? files[0]?.title ?? "";

  /* --------------------------------------------------------- upload step */

  const addFiles = useCallback(
    async (list: File[]) => {
      if (files.length + list.length > MAX_FILES) {
        toast.error(`문서는 한 번에 최대 ${MAX_FILES}개까지 추가할 수 있습니다.`);
        return;
      }
      setPreparing((n) => n + list.length);
      const results = await Promise.allSettled(list.map((f) => prepareFile(f)));
      setPreparing((n) => n - list.length);
      const ok: PreparedFile[] = [];
      const errors = new Set<string>();
      results.forEach((r) => {
        if (r.status === "fulfilled") ok.push(r.value);
        else errors.add(r.reason instanceof UploadError ? r.reason.message : "문서를 불러오지 못했습니다.");
      });
      errors.forEach((m) => toast.error(m));
      if (ok.length) {
        setFiles((prev) => [...prev, ...ok]);
        setKeepCurrent(false);
        setFilesDirty(true);
      }
    },
    [files.length],
  );

  async function leaveUpload() {
    if (busy) return;
    if (!filesDirty && source) {
      setStep("roles");
      return;
    }
    if (files.length === 0) {
      if (keepCurrent && source) setStep("roles");
      return;
    }
    setBusy("merge");
    try {
      const merged = await mergePrepared(files);
      const url = URL.createObjectURL(new Blob([merged.bytes.slice().buffer as ArrayBuffer], { type: "application/pdf" }));
      if (blobUrl.current) URL.revokeObjectURL(blobUrl.current);
      blobUrl.current = url;
      const name = files[0].title;
      setSource({ url, name, pageSizes: merged.pageSizes, bytes: merged.bytes });
      setFilesDirty(false);
      if (!title.trim()) setTitle(name.slice(0, 100));

      // keep only the fields that still fit the new document
      const pages = merged.pageSizes.length;
      const kept = fields.filter((f) => f.page <= pages).map((f) => clampToPage(f, merged.pageSizes[f.page - 1]));
      if (kept.length !== fields.length) toast(`문서의 페이지 수가 줄어 입력란 ${fields.length - kept.length}개가 삭제되었습니다.`);
      setFields(kept);
      setStep("roles");
    } catch (e) {
      toast.error(e instanceof UploadError ? e.message : "문서를 처리하지 못했습니다. 다시 시도해 주세요.");
    } finally {
      setBusy(null);
    }
  }

  /* ---------------------------------------------------------- roles step */

  const changeRequestType = (t: RequestType) => {
    setRequestType(t);
    setRoles((prev) => renumber(prev, t));
  };

  const moveRole = (from: number, to: number) => {
    if (to < 0 || to >= roles.length || from === to) return;
    setRoles((prev) => {
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return renumber(next, requestType);
    });
  };

  const addRole = () => {
    if (roles.length >= MAX_ROLES) return null;
    const key = newKey();
    setRoles((prev) => [...prev, { key, name: defaultRoleName(requestType, prev.length) }]);
    return key;
  };

  const removeRole = (index: number) => {
    const key = roles[index]?.key;
    if (!key) return;
    setRoles((prev) => renumber(prev.filter((_, i) => i !== index), requestType));
    setFields((prev) => prev.filter((f) => f.participantKey !== key));
  };

  const leaveRoles = () => {
    const res = parseRoles(roles);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setRoles(res.roles);
    setStep("fields");
  };

  /* --------------------------------------------------------- fields step */

  const leaveFields = () => {
    const msg = templateFieldsError(fields, roles, requestType);
    if (msg) {
      toast.error(msg);
      return;
    }
    setStep("info");
  };

  /* ------------------------------------------------------------- saving */

  async function uploadBytes(path: string, bytes: Uint8Array) {
    const supabase = createClient();
    const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: "application/pdf" });
    const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: "application/pdf", upsert: true });
    return !error;
  }

  async function save() {
    if (busy || !source) return;
    if (!title.trim()) {
      toast.error("템플릿 제목을 입력해 주세요.");
      return;
    }
    const rolesRes = parseRoles(roles);
    if (!rolesRes.ok) {
      toast.error(rolesRes.error);
      setStep("roles");
      return;
    }
    const missing = templateFieldsError(fields, roles, requestType);
    if (missing) {
      toast.error(missing);
      setStep("fields");
      return;
    }

    const payload: TemplatePayload = {
      title: title.trim(),
      requestType,
      signingOrder,
      roles: rolesRes.roles,
      fields,
      labelIds,
      shared,
      pageSizes: source.pageSizes,
    };

    setBusy("save");
    try {
      if (mode === "new") {
        if (!source.bytes) throw new UploadError("문서를 다시 업로드해 주세요.");
        const created = await createTemplate(wid, payload);
        if (!created.ok) throw new UploadError(created.error);
        if (!(await uploadBytes(created.path, source.bytes))) {
          void discardTemplate(wid, created.id);
          throw new UploadError("문서를 업로드하지 못했습니다. 잠시 후 다시 시도해 주세요.");
        }
        const attached = await attachTemplateFile(wid, created.id);
        if (!attached.ok) {
          void discardTemplate(wid, created.id);
          throw new UploadError(attached.error);
        }
        toast.success("템플릿을 등록했습니다.");
      } else {
        if (!templateId) throw new UploadError("잘못된 요청입니다.");
        if (source.bytes && !(await uploadBytes(paths.template(wid, templateId), source.bytes))) {
          throw new UploadError("문서를 업로드하지 못했습니다. 잠시 후 다시 시도해 주세요.");
        }
        const res = await updateTemplate(wid, templateId, payload, { fileReplaced: !!source.bytes });
        if (!res.ok) throw new UploadError(res.error);
        toast.success("템플릿을 저장했습니다.");
      }
      setSaved(true);
      router.push(listHref);
    } catch (e) {
      toast.error(e instanceof UploadError ? e.message : "템플릿을 저장하지 못했습니다. 네트워크 상태를 확인해 주세요.");
      setBusy(null);
    }
  }

  const exit = () => {
    setSaved(true);
    router.push(listHref);
  };

  const requestExit = () => (dirty ? setExitOpen(true) : exit());

  /* ------------------------------------------------------------- render */

  const currentDoc: CurrentDocument | null =
    keepCurrent && initial.document ? { url: initial.document.url, name: initial.document.name, pageCount: initial.document.pageSizes.length } : null;

  const saveButton = (
    <button
      type="button"
      onClick={save}
      disabled={!!busy || !title.trim()}
      className="flex h-[42px] min-w-[118px] items-center justify-center rounded-md bg-primary px-6 text-base font-medium text-primary-fg shadow-button hover:bg-primary-hover disabled:bg-btn-disabled disabled:text-fg-disabled disabled:shadow-none"
    >
      {busy === "save" ? "저장 중…" : mode === "new" ? "등록하기" : "저장하기"}
    </button>
  );

  const shell = (header: ReactNode, body: ReactNode, className = "min-h-screen bg-surface-2") => (
    <div className={`flex flex-col ${className}`}>
      {header}
      {body}
      <ExitModal open={exitOpen} mode={mode} onClose={() => setExitOpen(false)} onExit={exit} />
      {labelOpen && (
        <LabelPickerModal
          labels={labels}
          value={labelIds}
          description="이 템플릿으로 만든 문서에 붙일 라벨을 선택하세요."
          onClose={() => setLabelOpen(false)}
          onSave={(ids) => {
            setLabelIds(ids);
            setLabelOpen(false);
          }}
          onCreate={(name, color) => createTemplateLabel(wid, name, color)}
          onLabelsChange={setLabels}
        />
      )}
      <ConfirmModal
        open={deleteRole !== null}
        onClose={() => setDeleteRole(null)}
        onConfirm={() => deleteRole !== null && removeRole(deleteRole)}
        title="역할을 삭제할까요?"
        description={`이 역할에 배치한 입력란 ${deleteRole !== null ? (fieldCounts[roles[deleteRole]?.key] ?? 0) : 0}개도 함께 삭제됩니다.`}
        confirmLabel="삭제"
        danger
      />
    </div>
  );

  if (step === "upload") {
    return shell(
      <WizardHeader
        backLabel="나가기"
        showBackChevron={false}
        onBack={requestExit}
        primary={
          <WizardNextButton
            disabled={preparing > 0 || (files.length === 0 && !(keepCurrent && source))}
            loading={busy === "merge"}
            onClick={leaveUpload}
          />
        }
      />,
      <UploadStep
        mode={mode}
        files={files}
        current={currentDoc}
        preparing={preparing}
        disabled={!!busy}
        onAddFiles={(list) => void addFiles(list)}
        onRemoveFile={(key) => {
          setFiles((prev) => prev.filter((f) => f.key !== key));
          setFilesDirty(true);
        }}
        onRemoveCurrent={() => {
          setKeepCurrent(false);
          setFilesDirty(true);
        }}
        onRestoreCurrent={
          mode === "edit" && initial.document && !keepCurrent && files.length === 0 && preparing === 0 && source && !source.bytes
            ? () => {
                setKeepCurrent(true);
                setFilesDirty(false);
              }
            : undefined
        }
      />,
      "min-h-screen bg-body",
    );
  }

  if (!source) return null;

  if (step === "roles") {
    return shell(
      <WizardHeader onBack={() => setStep("upload")} primary={<WizardNextButton onClick={leaveRoles} />} />,
      <RolesStep
        mode={mode}
        documentName={documentName}
        pageCount={source.pageSizes.length}
        onChangeDocument={() => setStep("upload")}
        requestType={requestType}
        signingOrder={signingOrder}
        roles={roles}
        fieldCounts={fieldCounts}
        onRequestType={changeRequestType}
        onSigningOrder={setSigningOrder}
        onRename={(i, name) => setRoles((prev) => prev.map((r, j) => (j === i ? { ...r, name } : r)))}
        onAdd={addRole}
        onDelete={(i) => ((fieldCounts[roles[i]?.key] ?? 0) > 0 ? setDeleteRole(i) : removeRole(i))}
        onMove={moveRole}
      />,
    );
  }

  if (step === "fields") {
    return shell(
      <WizardHeader
        onBack={() => setStep("roles")}
        extra={
          <Button variant="neutral" size="lg" className="px-6" onClick={() => setPreviewOpen(true)}>
            미리보기
          </Button>
        }
        primary={<WizardNextButton onClick={leaveFields} />}
      />,
      <>
        {source.url ? (
          <FieldEditor
            pdfUrl={source.url}
            pageSizes={source.pageSizes}
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
          </div>
        )}
        <FieldPreviewModal
          open={previewOpen}
          onClose={() => setPreviewOpen(false)}
          pdfUrl={source.url}
          pageSizes={source.pageSizes}
          participants={participants}
          fields={fields}
        />
      </>,
      "h-dvh overflow-hidden bg-body-2",
    );
  }

  return shell(
    <WizardHeader onBack={() => setStep("fields")} primary={saveButton} />,
    <InfoStep
      mode={mode}
      title={title}
      onTitle={setTitle}
      labels={labels}
      labelIds={labelIds}
      onOpenLabels={() => setLabelOpen(true)}
      shared={shared}
      canShare={canShare}
      onShared={setShared}
      documentName={documentName}
      pageCount={source.pageSizes.length}
      requestType={requestType}
      signingOrder={signingOrder}
      roles={roles}
      fieldCounts={fieldCounts}
    />,
  );
}
