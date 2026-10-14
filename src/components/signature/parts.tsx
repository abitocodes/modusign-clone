"use client";

import { Eraser, ImageUp, LoaderCircle, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Checkbox } from "@/components/ui/controls";
import { Input, Select } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { MAX_UPLOAD_BYTES, UPLOAD_TYPES, processUploadedImage } from "./render";

/** Saved signature / stamp offered in the "이용 가능 사인/도장" tab */
export interface SavedSignature {
  id: string;
  image_data: string;
  created_at: string;
}

/** Height of the scrollable tab panel (dialog = 65 head + 46 tabs + 355 panel + 67 foot ≈ 533) */
export const PANEL_CLASS = "h-[355px] max-h-[calc(100vh-312px)] min-h-[240px] overflow-y-auto";

/** Centered 180×42 submit button of the 사인/도장 입력 dialogs */
export function SubmitButton({ disabled, busy, onClick }: { disabled: boolean; busy: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      aria-busy={busy}
      className={cn(
        "inline-flex h-[42px] w-[180px] items-center justify-center gap-2 rounded-md border text-base font-medium transition-colors",
        disabled
          ? "border-line bg-btn-disabled text-fg-disabled"
          : "border-primary-border bg-primary-hover text-primary-fg hover:bg-primary disabled:opacity-80",
      )}
    >
      {busy && <LoaderCircle className="size-4 animate-spin" />}
      입력하기
    </button>
  );
}

export function PanelCaption({ children }: { children: ReactNode }) {
  return <p className="text-center text-base text-fg-muted">{children}</p>;
}

/** Pill button under the drawing area (지우기 / 다른 이미지 선택) */
export function PillButton({ icon, children, onClick, disabled }: { icon?: ReactNode; children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-8 items-center gap-1 rounded-full border border-line-strong bg-btn-light px-3 text-sm font-medium text-fg-3 hover:bg-btn-base disabled:opacity-50 [&_svg]:size-4"
    >
      {icon}
      {children}
    </button>
  );
}

export function EraseButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <PillButton icon={<Eraser />} onClick={onClick} disabled={disabled}>
      지우기
    </PillButton>
  );
}

/**
 * [한글 ▼] [이름 입력] [만들기] row of the 사인 만들기 / 일반 도장 panels.
 * `script` is optional (법인 도장 uses its own inputs).
 */
export function NameRow<T extends string>({
  script,
  scripts,
  onScriptChange,
  value,
  onChange,
  onMake,
  placeholder = "이름을 입력하고 만들기 버튼을 눌러주세요.",
  maxLength = 20,
  makeDisabled,
}: {
  script: T;
  scripts: { value: T; label: string }[];
  onScriptChange: (v: T) => void;
  value: string;
  onChange: (v: string) => void;
  onMake: () => void;
  placeholder?: string;
  maxLength?: number;
  makeDisabled?: boolean;
}) {
  return (
    <div className="mx-auto mt-4 flex w-full max-w-[530px] items-center gap-1.5">
      <Select
        aria-label="문자 종류"
        wrapperClassName="w-[79px] shrink-0"
        className="border-line font-medium"
        value={script}
        onChange={(e) => onScriptChange(e.target.value as T)}
      >
        {scripts.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </Select>
      <Input
        aria-label="이름"
        className="min-w-0 flex-1 border-line"
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            onMake();
          }
        }}
      />
      <MakeButton onClick={onMake} disabled={makeDisabled} />
    </div>
  );
}

export function MakeButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="h-9 w-[68px] shrink-0 rounded bg-secondary text-sm font-medium text-secondary-fg hover:opacity-90 disabled:opacity-50"
    >
      만들기
    </button>
  );
}

/** Selectable preview tile (generated sign / stamp). Selected = dark card + yellow outline. */
export function ChoiceTile({
  selected,
  onSelect,
  label,
  className,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={label}
      onClick={onSelect}
      className={cn(
        "group flex items-center justify-center overflow-hidden rounded-md border transition-colors focus-visible:outline-2 focus-visible:outline-emphasis",
        selected ? "border-warning bg-surface ring-1 ring-inset ring-warning" : "border-line-strong bg-canvas hover:brightness-95",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function TileSkeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md border border-line-strong bg-surface-4", className)} aria-hidden />;
}

/* --------------------------------------------------------------- upload */

/**
 * 업로드 tab: PNG/JPG ≤ 5MB → white background removed (optional) → trimmed transparent PNG.
 * `value` is the processed PNG data URL.
 */
export function UploadPanel({
  value,
  onChange,
  kindLabel,
}: {
  value: string | null;
  onChange: (png: string | null) => void;
  kindLabel: "사인" | "도장";
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [removeWhite, setRemoveWhite] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  /** id of the latest processing job — results of older jobs are ignored */
  const jobRef = useRef(0);
  useEffect(
    () => () => {
      jobRef.current++;
    },
    [],
  );

  const run = (f: File, white: boolean) => {
    const job = ++jobRef.current;
    setBusy(true);
    processUploadedImage(f, { removeWhite: white })
      .then((png) => {
        if (job !== jobRef.current) return;
        if (!png) {
          toast.error(`이미지에서 ${kindLabel}을(를) 찾을 수 없습니다. 다른 이미지를 선택해 주세요.`);
          setFile(null);
          onChange(null);
          return;
        }
        onChange(png);
      })
      .catch(() => {
        if (job !== jobRef.current) return;
        toast.error("이미지를 불러오지 못했습니다. 다른 파일을 선택해 주세요.");
        setFile(null);
        onChange(null);
      })
      .finally(() => {
        if (job === jobRef.current) setBusy(false);
      });
  };

  const accept = (f: File | undefined | null) => {
    if (!f) return;
    const typeOk = UPLOAD_TYPES.includes(f.type) || /\.(png|jpe?g)$/i.test(f.name);
    if (!typeOk) {
      toast.error("PNG, JPG 형식의 이미지만 업로드할 수 있습니다.");
      return;
    }
    if (f.size > MAX_UPLOAD_BYTES) {
      toast.error("최대 5MB까지 업로드할 수 있습니다.");
      return;
    }
    setFile(f);
    onChange(null);
    run(f, removeWhite);
  };

  const toggleWhite = (v: boolean) => {
    setRemoveWhite(v);
    if (file) run(file, v);
  };

  const pick = () => inputRef.current?.click();

  return (
    <div className="mx-auto flex w-full max-w-[530px] flex-col pt-[50px]">
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg"
        className="hidden"
        onChange={(e) => {
          accept(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {file ? (
        <>
          <div className="relative flex aspect-[530/206] w-full items-center justify-center overflow-hidden rounded border border-icon-2 bg-canvas">
            {busy ? (
              <span className="flex items-center gap-2 text-sm text-neutral-600">
                <LoaderCircle className="size-4 animate-spin" />
                이미지 처리 중…
              </span>
            ) : value ? (
              // eslint-disable-next-line @next/next/no-img-element -- data URL preview
              <img src={value} alt={`업로드한 ${kindLabel}`} className="max-h-[85%] max-w-[90%] object-contain" />
            ) : null}
          </div>
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <Checkbox checked={removeWhite} onChange={toggleWhite} disabled={busy} label={<span className="text-[13px] text-fg-3">흰색 배경 제거</span>} />
            <div className="flex items-center gap-1.5">
              <PillButton icon={<ImageUp />} onClick={pick} disabled={busy}>
                다른 이미지 선택
              </PillButton>
              <PillButton
                icon={<X />}
                onClick={() => {
                  jobRef.current++;
                  setBusy(false);
                  setFile(null);
                  onChange(null);
                }}
                disabled={busy}
              >
                삭제
              </PillButton>
            </div>
          </div>
        </>
      ) : (
        <button
          type="button"
          onClick={pick}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            accept(e.dataTransfer.files?.[0]);
          }}
          className={cn(
            "flex aspect-[530/206] w-full flex-col items-center justify-center gap-2 rounded border border-dashed px-6 text-center transition-colors",
            dragging ? "border-emphasis bg-emphasis-bg" : "border-line-strong bg-surface-3 hover:bg-surface-4",
          )}
        >
          <ImageUp className="size-7 text-fg-faint" strokeWidth={1.6} />
          <span className="text-sm font-medium text-fg-2">이미지 파일을 끌어다 놓거나 클릭하여 업로드하세요</span>
          <span className="text-[13px] text-fg-faint">PNG, JPG · 최대 5MB · 흰색 배경은 자동으로 제거됩니다</span>
        </button>
      )}
    </div>
  );
}

/* --------------------------------------------------------- saved items */

/** "2025.1.03에 등록됨" */
function registeredLabel(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}.${d.getMonth() + 1}.${String(d.getDate()).padStart(2, "0")}에 등록됨`;
}

const SAVED_PAGE = 6;

/** 이용 가능 사인 / 도장 tab */
export function SavedPanel({
  items,
  selectedId,
  onSelect,
  kindLabel,
}: {
  items: SavedSignature[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  kindLabel: "사인" | "도장";
}) {
  const [visible, setVisible] = useState(SAVED_PAGE);
  if (items.length === 0) {
    return <p className="pt-[76px] text-center text-[13px] font-bold text-fg-2">이용할 수 있는 {kindLabel}이 없습니다.</p>;
  }
  return (
    <div className="mx-auto w-full max-w-[575px] px-0 pb-4 pt-[30px]">
      <div role="radiogroup" aria-label={`이용 가능 ${kindLabel}`} className="grid grid-cols-1 gap-3 min-[520px]:grid-cols-2">
        {items.slice(0, visible).map((s) => {
          const selected = s.id === selectedId;
          return (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onSelect(s.id)}
              className={cn(
                "flex h-[159px] flex-col overflow-hidden border text-left transition-colors focus-visible:outline-2 focus-visible:outline-emphasis",
                selected ? "border-emphasis ring-1 ring-inset ring-emphasis" : "border-line-strong hover:border-fg-faint",
              )}
            >
              <span className="flex h-[114px] w-full shrink-0 items-center justify-center bg-canvas">
                {/* eslint-disable-next-line @next/next/no-img-element -- data URL */}
                <img src={s.image_data} alt="" className="max-h-[80px] max-w-[195px] object-contain" />
              </span>
              <span className="flex flex-1 items-center justify-center border-t border-line-light text-[13px] text-fg-muted">
                {registeredLabel(s.created_at)}
              </span>
            </button>
          );
        })}
      </div>
      {visible < items.length && (
        <button
          type="button"
          onClick={() => setVisible((v) => v + SAVED_PAGE)}
          className="mt-3 flex h-[38px] w-full items-center justify-center rounded text-sm font-medium text-fg-2 hover:bg-btn-light"
        >
          + 사인·도장 더 보기
        </button>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- toast */

function WarnTriangle() {
  return (
    <svg viewBox="0 0 16 16" className="mt-px size-4 shrink-0" aria-hidden>
      <path d="M8 1.2 15.3 14H.7L8 1.2Z" className="fill-negative" strokeLinejoin="round" />
      <path d="M8 5.6v4.2" className="stroke-white" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="8" cy="11.9" r=".95" className="fill-white" />
    </svg>
  );
}

/** Bottom-left error toast shown when a drawn signature is rejected */
export function showSignDrawFailToast() {
  toast.custom(
    (id) => (
      <div role="alert" className="relative w-[334px] max-w-[calc(100vw-32px)] rounded-md border border-line-strong bg-menu p-3.5 pr-9 shadow-toast">
        <div className="flex gap-2">
          <WarnTriangle />
          <div className="text-[13px] leading-[1.55] text-fg">
            <p className="font-bold">사인 그리기 실패</p>
            <p className="mt-0.5">
              사인을 식별할 수 없습니다.
              <br />
              본인의 실제 사인으로 정확하게 그려주세요.
            </p>
          </div>
        </div>
        <button
          type="button"
          aria-label="닫기"
          onClick={() => toast.dismiss(id)}
          className="absolute right-2.5 top-2.5 flex size-6 items-center justify-center rounded text-fg-muted hover:bg-menu-hover hover:text-fg"
        >
          <X className="size-4" />
        </button>
      </div>
    ),
    {
      id: "sign-draw-fail",
      position: "bottom-left",
      duration: 5000,
      style: { background: "transparent", border: "none", boxShadow: "none", padding: 0 },
    },
  );
}
