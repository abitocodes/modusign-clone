"use client";

import { Loader2, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState, type DragEvent, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { WizardHeader, WizardNextButton } from "@/components/wizard/wizard-header";
import { createClient } from "@/lib/supabase/client";
import { BUCKET } from "@/lib/storage";
import { cn } from "@/lib/utils";

import { attachUploadedFile, createDraftDocument, discardFailedDraft } from "./actions";
import { mergePrepared, prepareFile, UploadError, type PreparedFile } from "./pdf-utils";
import { TemplateSection, type TemplateCardData } from "./template-section";

const ACCEPT = "application/pdf,.pdf,image/jpeg,.jpg,.jpeg,image/png,.png";
const MAX_FILES = 20;

/** Dashed outline drawn with SVG (CSS dashed borders look different from the original). */
function DashedFrame({ active }: { active: boolean }) {
  return (
    <svg className="pointer-events-none absolute inset-0 size-full" aria-hidden>
      {/* 2px stroke on the edge: the outer half is clipped by the svg box → 1px visible dash */}
      <rect
        x="0"
        y="0"
        width="100%"
        height="100%"
        fill="none"
        strokeWidth="2"
        strokeDasharray="6 4"
        className={active ? "stroke-emphasis" : "stroke-line-strong"}
      />
    </svg>
  );
}

function DropArea({
  className,
  onFiles,
  onPick,
  children,
  disabled,
}: {
  className?: string;
  onFiles: (files: File[]) => void;
  onPick: () => void;
  children?: ReactNode;
  disabled?: boolean;
}) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);

  const handlers = {
    onDragEnter: (e: DragEvent) => {
      if (!Array.from(e.dataTransfer.types).includes("Files")) return;
      e.preventDefault();
      depth.current++;
      setOver(true);
    },
    onDragOver: (e: DragEvent) => {
      if (!Array.from(e.dataTransfer.types).includes("Files")) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = disabled ? "none" : "copy";
    },
    onDragLeave: () => {
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setOver(false);
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      depth.current = 0;
      setOver(false);
      if (disabled) return;
      const files = Array.from(e.dataTransfer.files);
      if (files.length) onFiles(files);
    },
  };

  return (
    <div
      {...handlers}
      className={cn("relative flex flex-col items-center justify-center px-8 text-center transition-colors", over ? "bg-emphasis-bg" : "bg-surface", className)}
    >
      <DashedFrame active={over} />
      {children ?? (
        <>
          <p className="text-base text-fg-muted">전송할 문서를 드래그 앤 드롭 또는 버튼 눌러 업로드</p>
          <Button variant="neutral" size="lg" className="mt-3 px-4" icon={<Plus className="size-4" />} onClick={onPick} disabled={disabled}>
            문서 추가
          </Button>
        </>
      )}
    </div>
  );
}

function FileCard({ file, onRemove, disabled }: { file: PreparedFile; onRemove: () => void; disabled?: boolean }) {
  return (
    <div className="relative flex h-64 w-[292px] shrink-0 flex-col overflow-hidden border border-line bg-surface-3">
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={file.thumb} alt={`${file.name} 첫 페이지`} className="mx-auto mt-10 w-[190px] bg-page shadow-card" draggable={false} />
        <button
          type="button"
          aria-label={`${file.name} 삭제`}
          title="삭제"
          disabled={disabled}
          onClick={onRemove}
          className="absolute right-2 top-2 flex size-8 items-center justify-center rounded text-fg-2 hover:bg-btn-light disabled:opacity-40"
        >
          <X className="size-5" />
        </button>
      </div>
      <div className="flex h-[62px] shrink-0 items-center gap-2 border-t border-line bg-surface-3 px-4">
        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded bg-menu px-1 text-xs text-fg-2" title="페이지 수">
          {file.pageCount}
        </span>
        <span className="truncate text-base font-medium text-fg" title={file.name}>
          {file.title}
        </span>
      </div>
    </div>
  );
}

export function UploadClient({ wid, templates }: { wid: string; templates: TemplateCardData[] }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<PreparedFile[]>([]);
  const [preparing, setPreparing] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  const pick = useCallback(() => inputRef.current?.click(), []);

  const addFiles = useCallback(
    async (list: File[]) => {
      if (files.length + list.length > MAX_FILES) {
        toast.error(`문서는 한 번에 최대 ${MAX_FILES}개까지 추가할 수 있습니다.`);
        return;
      }
      setPreparing((n) => n + list.length);
      // keep the chosen order even though files are prepared in parallel
      const results = await Promise.allSettled(list.map((f) => prepareFile(f)));
      setPreparing((n) => n - list.length);
      const ok: PreparedFile[] = [];
      const errors = new Set<string>();
      results.forEach((r) => {
        if (r.status === "fulfilled") ok.push(r.value);
        else errors.add(r.reason instanceof UploadError ? r.reason.message : "문서를 불러오지 못했습니다.");
      });
      errors.forEach((m) => toast.error(m));
      if (ok.length) setFiles((prev) => [...prev, ...ok]);
    },
    [files.length],
  );

  async function next() {
    if (!files.length || submitting) return;
    setSubmitting(true);
    let createdId: string | null = null;
    try {
      const merged = await mergePrepared(files);
      const title = files[0].title;
      const created = await createDraftDocument(wid, {
        title,
        fileName: `${title}.pdf`,
        pageCount: merged.pageCount,
        pageSizes: merged.pageSizes,
        sizeBytes: merged.bytes.byteLength,
      });
      if (!created.ok) throw new UploadError(created.error);
      createdId = created.id;

      const supabase = createClient();
      const blob = new Blob([merged.bytes.slice().buffer as ArrayBuffer], { type: "application/pdf" });
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(created.path, blob, { contentType: "application/pdf", upsert: true });
      if (upErr) throw new UploadError("문서를 업로드하지 못했습니다. 잠시 후 다시 시도해 주세요.");

      const attached = await attachUploadedFile(created.id);
      if (!attached.ok) throw new UploadError(attached.error);

      router.push(`/workspaces/${wid}/documents/d/${created.id}/steps/1`);
    } catch (e) {
      if (createdId) void discardFailedDraft(createdId);
      toast.error(e instanceof UploadError ? e.message : "문서를 처리하지 못했습니다. 다시 시도해 주세요.");
      setSubmitting(false);
    }
  }

  const busy = preparing > 0 || submitting;

  return (
    <div className="flex min-h-screen flex-col bg-body">
      <WizardHeader
        onBack={() => router.push(`/workspaces/${wid}/esign/requests/request`)}
        primary={<WizardNextButton disabled={!files.length || preparing > 0} loading={submitting} onClick={next} />}
      />

      <main className="flex-1">
        <section className="mx-auto w-full max-w-[968px] px-4 pb-11 pt-[52px]">
          <h1 className="text-[32px] font-bold leading-tight text-fg">문서 업로드</h1>

          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            multiple
            hidden
            onChange={(e) => {
              const list = Array.from(e.target.files ?? []);
              e.target.value = "";
              if (list.length) void addFiles(list);
            }}
          />

          <div className="mt-6">
            {files.length === 0 && preparing === 0 ? (
              <DropArea className="h-[264px]" onFiles={addFiles} onPick={pick} disabled={busy} />
            ) : (
              <div className="flex flex-wrap gap-[18px]">
                {files.map((f) => (
                  <FileCard key={f.key} file={f} disabled={submitting} onRemove={() => setFiles((prev) => prev.filter((x) => x.key !== f.key))} />
                ))}
                {preparing > 0 && (
                  <div className="flex h-64 w-[292px] flex-col items-center justify-center gap-3 border border-line bg-surface-3 text-sm text-fg-muted">
                    <Loader2 className="size-6 animate-spin text-icon-2" />
                    문서를 불러오는 중…
                  </div>
                )}
                <DropArea className="h-64 w-[292px]" onFiles={addFiles} onPick={pick} disabled={busy}>
                  <p className="text-base leading-snug text-fg-muted">전송할 문서를 드래그 앤 드롭 또는 버튼 눌러 업로드</p>
                  <Button variant="neutral" size="lg" className="mt-3 px-4" icon={<Plus className="size-4" />} onClick={pick} disabled={busy}>
                    문서 추가
                  </Button>
                </DropArea>
              </div>
            )}
          </div>

          <ul className="mt-3 space-y-1 text-sm text-fg-muted">
            <li className="flex items-center gap-2">
              <span className="size-[3px] bg-fg-muted" aria-hidden />
              PDF: 최대 10MB
            </li>
            <li className="flex items-center gap-2">
              <span className="size-[3px] bg-fg-muted" aria-hidden />
              JPG, PNG: 최대 5MB
            </li>
            {files.length > 1 && (
              <li className="flex items-center gap-2 text-fg-faint">
                <span className="size-[3px] bg-fg-faint" aria-hidden />
                여러 문서는 추가한 순서대로 하나의 문서로 합쳐집니다.
              </li>
            )}
          </ul>
        </section>

        <TemplateSection wid={wid} templates={templates} />
      </main>
    </div>
  );
}
