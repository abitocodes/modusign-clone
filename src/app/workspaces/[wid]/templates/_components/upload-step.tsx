"use client";

import { Loader2, Plus, X } from "lucide-react";
import { useRef, useState, type DragEvent, type ReactNode } from "react";

import type { PreparedFile } from "@/app/workspaces/[wid]/documents/d/upload/pdf-utils";
import { PdfFirstPage } from "@/components/templates/parts";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const ACCEPT = "application/pdf,.pdf,image/jpeg,.jpg,.jpeg,image/png,.png";

/** Dashed outline drawn with SVG (same look as the wizard's upload area). */
function DashedFrame({ active }: { active: boolean }) {
  return (
    <svg className="pointer-events-none absolute inset-0 size-full" aria-hidden>
      <rect x="0" y="0" width="100%" height="100%" fill="none" strokeWidth="2" strokeDasharray="6 4" className={active ? "stroke-emphasis" : "stroke-line-strong"} />
    </svg>
  );
}

function DropArea({
  className,
  onFiles,
  disabled,
  children,
}: {
  className?: string;
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes("Files");
  return (
    <div
      onDragEnter={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        depth.current++;
        setOver(true);
      }}
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = disabled ? "none" : "copy";
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        depth.current = 0;
        setOver(false);
        if (disabled) return;
        const files = Array.from(e.dataTransfer.files);
        if (files.length) onFiles(files);
      }}
      className={cn("relative flex flex-col items-center justify-center px-8 text-center transition-colors", over ? "bg-emphasis-bg" : "bg-surface", className)}
    >
      <DashedFrame active={over} />
      {children}
    </div>
  );
}

function CardShell({ title, pages, thumb, onRemove, removeLabel, disabled }: { title: string; pages: number; thumb: ReactNode; onRemove: () => void; removeLabel: string; disabled?: boolean }) {
  return (
    <div className="relative flex h-64 w-[292px] shrink-0 flex-col overflow-hidden border border-line bg-surface-3">
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div className="mx-auto mt-10 w-[190px] shadow-card">{thumb}</div>
        <button
          type="button"
          aria-label={removeLabel}
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
          {pages}
        </span>
        <span className="truncate text-base font-medium text-fg" title={title}>
          {title}
        </span>
      </div>
    </div>
  );
}

export interface CurrentDocument {
  url: string;
  name: string;
  pageCount: number;
}

/** Step A — 문서 업로드 (PDF / JPG / PNG, merged in order like the sign-request wizard). */
export function UploadStep({
  mode,
  files,
  current,
  preparing,
  disabled,
  onAddFiles,
  onRemoveFile,
  onRemoveCurrent,
  onRestoreCurrent,
}: {
  mode: "new" | "edit";
  files: PreparedFile[];
  /** edit mode: the template's current document (until replaced) */
  current: CurrentDocument | null;
  preparing: number;
  disabled: boolean;
  onAddFiles: (files: File[]) => void;
  onRemoveFile: (key: string) => void;
  onRemoveCurrent: () => void;
  /** edit mode: brings the removed current document back (only while nothing new was added) */
  onRestoreCurrent?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const pick = () => inputRef.current?.click();
  const empty = files.length === 0 && preparing === 0 && !current;

  const addButton = (
    <Button variant="neutral" size="lg" className="mt-3 px-4" icon={<Plus className="size-4" />} onClick={pick} disabled={disabled}>
      문서 추가
    </Button>
  );

  return (
    <main className="flex-1">
      <section className="mx-auto w-full max-w-[968px] px-4 pb-16 pt-[52px]">
        <p className="text-[13px] font-medium text-fg-muted">{mode === "new" ? "템플릿 등록" : "템플릿 수정"} · 1/4단계</p>
        <h1 className="mt-1 text-[32px] font-bold leading-tight text-fg">문서 업로드</h1>
        <p className="mt-2 text-base text-fg-muted">
          {mode === "new" ? "템플릿으로 저장할 문서를 올려 주세요." : "문서를 바꾸려면 기존 문서를 삭제하고 새 문서를 올려 주세요. 새 문서에 없는 페이지의 입력란은 삭제됩니다."}
        </p>

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          hidden
          onChange={(e) => {
            const list = Array.from(e.target.files ?? []);
            e.target.value = "";
            if (list.length) onAddFiles(list);
          }}
        />

        <div className="mt-6">
          {empty ? (
            <DropArea className="h-[264px]" onFiles={onAddFiles} disabled={disabled}>
              <p className="text-base text-fg-muted">템플릿으로 만들 문서를 드래그 앤 드롭 또는 버튼 눌러 업로드</p>
              {addButton}
              {onRestoreCurrent && (
                <button
                  type="button"
                  onClick={onRestoreCurrent}
                  disabled={disabled}
                  className="mt-3 text-[13px] text-fg-muted underline underline-offset-2 hover:text-fg-2 disabled:opacity-50"
                >
                  기존 문서 그대로 사용
                </button>
              )}
            </DropArea>
          ) : (
            <div className="flex flex-wrap gap-[18px]">
              {current && (
                <CardShell
                  title={current.name}
                  pages={current.pageCount}
                  thumb={<PdfFirstPage url={current.url} width={190} />}
                  removeLabel={`${current.name} 삭제 (문서 교체)`}
                  onRemove={onRemoveCurrent}
                  disabled={disabled}
                />
              )}
              {files.map((f) => (
                <CardShell
                  key={f.key}
                  title={f.title}
                  pages={f.pageCount}
                  // eslint-disable-next-line @next/next/no-img-element
                  thumb={<img src={f.thumb} alt={`${f.name} 첫 페이지`} className="block w-full bg-page" draggable={false} />}
                  removeLabel={`${f.name} 삭제`}
                  onRemove={() => onRemoveFile(f.key)}
                  disabled={disabled}
                />
              ))}
              {preparing > 0 && (
                <div className="flex h-64 w-[292px] flex-col items-center justify-center gap-3 border border-line bg-surface-3 text-sm text-fg-muted" role="status">
                  <Loader2 className="size-6 animate-spin text-icon-2" />
                  문서를 불러오는 중…
                </div>
              )}
              {!current && (
                <DropArea className="h-64 w-[292px]" onFiles={onAddFiles} disabled={disabled}>
                  <p className="text-base leading-snug text-fg-muted">문서를 드래그 앤 드롭 또는 버튼 눌러 추가</p>
                  {addButton}
                </DropArea>
              )}
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
    </main>
  );
}
