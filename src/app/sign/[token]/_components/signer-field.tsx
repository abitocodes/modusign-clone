"use client";

import { Check, ChevronDown, CircleDot, Image as ImageIcon, Signature, Stamp, X } from "lucide-react";
import { useRef, type CSSProperties, type ReactNode } from "react";
import { toast } from "sonner";

import { fieldFontSize } from "@/components/editor/editor-model";
import { FieldValue } from "@/components/fields/field-value";
import { cn, withAlpha } from "@/lib/utils";

import type { FilledField, SignerField } from "../_lib/types";
import { fieldLabel, hasValue } from "../_lib/validate";

/** on-paper ink colours (the PDF page is always white, whatever the app theme) */
const INK = "#292929";
const GUIDE_INK = "#9e9e9e";

const SIGN_ICONS = { any: CircleDot, sign: Signature, stamp: Stamp } as const;

const pos = (f: { x: number; y: number; width: number; height: number }, scale: number): CSSProperties => ({
  left: f.x * scale,
  top: f.y * scale,
  width: f.width * scale,
  height: f.height * scale,
});

/** Another participant's completed field — plain content, no chrome. */
export function FilledFieldView({ f, scale }: { f: FilledField; scale: number }) {
  return (
    <div className="pointer-events-none absolute" style={pos(f, scale)}>
      <FieldValue field={{ type: f.type, value: f.value, options: f.options, height: f.height }} scale={scale} />
    </div>
  );
}

/* ------------------------------------------------------------ image input */

const MAX_IMAGE_FILE = 10 * 1024 * 1024;
const MAX_IMAGE_SIDE = 1600;

/** PNG/JPEG file → data URL (downscaled to ≤1600px; large files re-encoded as JPEG) */
async function imageFileToDataUrl(file: File): Promise<string> {
  if (!["image/png", "image/jpeg"].includes(file.type)) throw new Error("PNG 또는 JPG 이미지만 첨부할 수 있습니다.");
  if (file.size > MAX_IMAGE_FILE) throw new Error("10MB 이하의 이미지를 첨부해 주세요.");
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("이미지를 읽지 못했습니다."));
      el.src = url;
    });
    const ratio = Math.min(1, MAX_IMAGE_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * ratio));
    const h = Math.max(1, Math.round(img.naturalHeight * ratio));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext("2d");
    if (!g) throw new Error("이미지를 처리하지 못했습니다.");
    const keepPng = file.type === "image/png" && file.size <= 1.5 * 1024 * 1024;
    if (!keepPng) {
      g.fillStyle = "#ffffff";
      g.fillRect(0, 0, w, h);
    }
    g.drawImage(img, 0, 0, w, h);
    return keepPng ? canvas.toDataURL("image/png") : canvas.toDataURL("image/jpeg", 0.88);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* ------------------------------------------------------------- my fields */

export interface MyFieldProps {
  f: SignerField;
  value: string;
  scale: number;
  color: string;
  /** signing mode (inputs enabled) vs. the passive preview */
  interactive: boolean;
  current: boolean;
  error: string | null;
  today: string;
  onActivate: (id: string) => void;
  onChange: (id: string, value: string) => void;
  onBlur: (id: string) => void;
  onSign: (f: SignerField) => void;
}

/** One of MY fields on the page, with its inline editor. */
export function MyField({ f, value, scale, color, interactive, current, error, today, onActivate, onChange, onBlur, onSign }: MyFieldProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const fs = fieldFontSize(f) * scale;
  const filled = hasValue(f, value);
  const label = fieldLabel(f);

  if (f.type === "signed_date") {
    return (
      <div
        className="pointer-events-none absolute flex items-center overflow-hidden whitespace-nowrap px-[2px] leading-none"
        style={{ ...pos(f, scale), fontSize: fs, color: INK }}
        aria-label={`서명한 날짜 ${today}`}
      >
        {today}
      </div>
    );
  }

  const media = f.type === "signature" || f.type === "image";
  const frame: CSSProperties = {
    ...pos(f, scale),
    background: media && filled ? "transparent" : f.type === "checkbox" ? "#ffffff" : withAlpha(color, filled ? 0.12 : 0.2),
    // an invalid field that is not being edited keeps a red frame; its message shows once focused
    border: `1px solid ${interactive && error && !current ? "var(--negative)" : color}`,
    outline: current && interactive ? "2px solid var(--emphasis)" : undefined,
    outlineOffset: -1,
    borderRadius: 2,
  };
  const common = {
    "data-field-control": "",
    "aria-label": `${f.required ? "(필수)" : "(선택)"} ${label}`,
    "aria-invalid": !!error || undefined,
    tabIndex: interactive ? 0 : -1,
    onFocus: () => onActivate(f.id),
  };
  const textStyle: CSSProperties = { fontSize: fs, color: INK };

  let body: ReactNode;
  switch (f.type) {
    case "text":
      body = (
        <input
          {...common}
          value={value}
          readOnly={!interactive}
          inputMode={f.options.format === "number" ? "decimal" : f.options.format === "phone" ? "tel" : f.options.format === "email" ? "email" : undefined}
          maxLength={500}
          placeholder={f.options.placeholder ?? ""}
          onChange={(e) => onChange(f.id, e.target.value)}
          onBlur={() => onBlur(f.id)}
          className="size-full bg-transparent px-[2px] leading-none outline-none placeholder:text-[#9e9e9e]"
          style={textStyle}
        />
      );
      break;
    case "transcribe":
      body = (
        <textarea
          {...common}
          value={value}
          readOnly={!interactive}
          maxLength={1000}
          placeholder={f.options.sentence || f.options.placeholder || "따라쓰기"}
          onChange={(e) => onChange(f.id, e.target.value)}
          onBlur={() => onBlur(f.id)}
          className="size-full resize-none overflow-hidden bg-transparent px-[3px] py-[2px] leading-tight outline-none placeholder:text-[#9e9e9e]"
          style={textStyle}
        />
      );
      break;
    case "dropdown": {
      const items = (f.options.items ?? []).filter(Boolean);
      body = (
        <span className="relative flex size-full items-center">
          <select
            {...common}
            value={value}
            disabled={!interactive}
            onChange={(e) => onChange(f.id, e.target.value)}
            onBlur={() => onBlur(f.id)}
            className="size-full cursor-pointer appearance-none bg-transparent pl-[2px] pr-[1.1em] leading-none outline-none disabled:cursor-default disabled:opacity-100"
            style={{ ...textStyle, color: value ? INK : GUIDE_INK }}
          >
            <option value="" disabled>
              {f.options.placeholder || "선택"}
            </option>
            {items.map((it) => (
              <option key={it} value={it} style={{ color: INK }}>
                {it}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-[2px] text-[#474747]" style={{ width: fs, height: fs }} strokeWidth={2.4} />
        </span>
      );
      break;
    }
    case "date":
      body = (
        <span className="relative flex size-full items-center overflow-hidden whitespace-nowrap px-[2px] leading-none" style={textStyle}>
          <span style={{ color: value ? INK : GUIDE_INK }}>{value || f.options.placeholder || "YYYY-MM-DD"}</span>
          <input
            {...common}
            type="date"
            value={value}
            disabled={!interactive}
            onChange={(e) => onChange(f.id, e.target.value)}
            onBlur={() => onBlur(f.id)}
            onClick={(e) => {
              try {
                e.currentTarget.showPicker();
              } catch {
                /* not supported — the native input still accepts typing */
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                try {
                  e.currentTarget.showPicker();
                } catch {
                  /* ignore */
                }
              }
            }}
            className="absolute inset-0 size-full cursor-pointer opacity-0"
          />
        </span>
      );
      break;
    case "checkbox":
      body = (
        <button
          {...common}
          type="button"
          role="checkbox"
          aria-checked={value === "true"}
          disabled={!interactive}
          onClick={() => {
            onChange(f.id, value === "true" ? "" : "true");
            onBlur(f.id);
          }}
          className="flex size-full items-center justify-center"
          style={{ color: "#212121" }}
        >
          {value === "true" && <Check className="size-[90%]" strokeWidth={3} />}
        </button>
      );
      break;
    case "signature": {
      const Icon = SIGN_ICONS[f.options.signMode ?? "any"];
      const s = Math.min(32, Math.max(10, Math.min(f.width, f.height) * scale * 0.24));
      body = (
        <button {...common} type="button" disabled={!interactive} onClick={() => onSign(f)} className="flex size-full items-center justify-center">
          {filled ? (
            // eslint-disable-next-line @next/next/no-img-element -- data URL
            <img src={value} alt="입력한 서명" className="pointer-events-none size-full object-contain" draggable={false} />
          ) : (
            <Icon style={{ width: s, height: s, color }} strokeWidth={2.4} />
          )}
        </button>
      );
      break;
    }
    case "image": {
      const s = Math.min(28, Math.max(10, Math.min(f.width, f.height) * scale * 0.3));
      body = (
        <>
          <button
            {...common}
            type="button"
            disabled={!interactive}
            onClick={() => fileRef.current?.click()}
            className="flex size-full flex-col items-center justify-center gap-0.5 overflow-hidden"
          >
            {filled ? (
              // eslint-disable-next-line @next/next/no-img-element -- data URL
              <img src={value} alt="첨부한 이미지" className="pointer-events-none size-full object-contain" draggable={false} />
            ) : (
              <>
                <ImageIcon style={{ width: s, height: s, color }} strokeWidth={2} />
                {f.height * scale > 44 && <span className="text-[11px] font-medium text-[#474747]">이미지 첨부</span>}
              </>
            )}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg"
            className="hidden"
            tabIndex={-1}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              try {
                onChange(f.id, await imageFileToDataUrl(file));
                onBlur(f.id);
              } catch (err) {
                toast.error((err as Error).message);
              }
            }}
          />
        </>
      );
      break;
    }
  }

  return (
    <div
      data-field-id={f.id}
      className={cn("absolute", interactive ? "z-10" : "pointer-events-none", current && interactive && "z-20")}
      style={frame}
      onMouseDown={() => interactive && onActivate(f.id)}
    >
      {body}
      {interactive && current && (
        <span className="pointer-events-none absolute bottom-full left-0 mb-1 whitespace-nowrap rounded-[3px] bg-tooltip px-1.5 py-0.5 text-[11px] font-bold leading-[1.4] text-fg-strong shadow-menu">
          ({f.required ? "필수" : "선택"}) {label}
        </span>
      )}
      {interactive && current && error && (
        <span role="alert" className="pointer-events-none absolute left-0 top-full z-30 mt-1 whitespace-nowrap rounded-[3px] border border-negative-border bg-negative-bg px-1.5 py-0.5 text-[11px] font-bold leading-[1.4] text-negative shadow-menu">
          {error}
        </span>
      )}
      {interactive && current && media && filled && (
        <button
          type="button"
          aria-label={`${label} 지우기`}
          onClick={(e) => {
            e.stopPropagation();
            onChange(f.id, "");
          }}
          className="absolute -right-2.5 -top-2.5 flex size-5 items-center justify-center rounded-full bg-tooltip text-fg-strong shadow-menu hover:bg-menu"
        >
          <X className="size-3" strokeWidth={3} />
        </button>
      )}
    </div>
  );
}

/** Yellow pentagon "다음" tab in the gutter, pointing at the current field. */
export function GuideTab({ top, left, compact, onClick }: { top: number; left: number; compact?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="다음 입력란으로 이동"
      className={cn(
        "absolute z-30 -translate-y-1/2 drop-shadow-[0_2px_4px_rgba(0,0,0,0.35)] transition-[top] duration-300 ease-out",
        compact ? "h-[28px] w-[52px]" : "h-[42px] w-[103px]",
      )}
      style={{ top, left }}
    >
      <svg viewBox="0 0 103 42" preserveAspectRatio="none" className="absolute inset-0 size-full" aria-hidden>
        <path d="M21 .5h65.3l15.9 20.5-15.9 20.5H21a20.5 20.5 0 0 1 0-41Z" className="fill-p1 stroke-p1" />
      </svg>
      <span className={cn("relative block font-medium text-fg-reversed", compact ? "pr-2 text-xs" : "pr-4 text-[15px]")}>다음</span>
    </button>
  );
}
