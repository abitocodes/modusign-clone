import { ChevronDown, CircleDot, Image as ImageIcon, PenLine, Signature, Stamp, type LucideIcon } from "lucide-react";
import type { CSSProperties, PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from "react";

import { cn, withAlpha } from "@/lib/utils";

import { clamp, fieldFontSize, fieldPlaceholder, fieldTitle, type EditorField, type SignMode } from "./editor-model";

export const SIGN_MODE_ICONS: Record<SignMode, LucideIcon> = { any: CircleDot, sign: Signature, stamp: Stamp };

/** Tint of a placed field (participant colour with alpha). */
export function fieldTint(type: EditorField["type"]) {
  return type === "signature" ? 0.3 : 0.2;
}

/**
 * The inside of a field box as the requester sees it in the editor
 * (icon for signature/image, placeholder text for text-like fields).
 * `scale` = CSS px per PDF point.
 */
export function FieldBoxContent({
  field,
  color,
  scale,
  text,
}: {
  field: Pick<EditorField, "type" | "options" | "width" | "height">;
  color: string;
  scale: number;
  /** overrides the placeholder (used by the signer preview) */
  text?: string;
}) {
  const w = field.width * scale;
  const h = field.height * scale;
  switch (field.type) {
    case "signature": {
      const Icon = SIGN_MODE_ICONS[field.options.signMode ?? "any"];
      const s = clamp(Math.min(w, h) * 0.24, 10, 32);
      return (
        <span className="flex size-full items-center justify-center">
          <Icon style={{ width: s, height: s, color }} strokeWidth={2.4} />
        </span>
      );
    }
    case "checkbox":
      return null;
    case "image": {
      const s = clamp(Math.min(w, h) * 0.3, 10, 28);
      return (
        <span className="flex size-full flex-col items-center justify-center gap-0.5 overflow-hidden" style={{ color }}>
          <ImageIcon style={{ width: s, height: s }} strokeWidth={2} />
          {h > 44 && <span className="text-[11px] font-medium text-[#474747]">이미지</span>}
        </span>
      );
    }
    case "transcribe": {
      const fs = fieldFontSize(field) * scale;
      const value = text ?? fieldPlaceholder(field);
      return (
        <span
          className="flex size-full items-start gap-1 overflow-hidden px-[3px] py-[2px] leading-tight text-[#292929]"
          style={{ fontSize: fs }}
        >
          {!text && <PenLine className="mt-[0.1em] shrink-0 opacity-60" style={{ width: fs, height: fs, color }} />}
          <span className={cn("min-w-0 break-words", !field.options.sentence && !text && "opacity-60")}>{value}</span>
        </span>
      );
    }
    default: {
      const fs = fieldFontSize(field) * scale;
      return (
        <span
          className="flex size-full items-center overflow-hidden whitespace-nowrap px-[2px] leading-none text-[#292929]"
          style={{ fontSize: fs }}
        >
          <span className="min-w-0 truncate">{text ?? fieldPlaceholder(field)}</span>
          {field.type === "dropdown" && (
            <ChevronDown className="ml-auto shrink-0 text-[#474747]" style={{ width: fs, height: fs }} strokeWidth={2.4} />
          )}
        </span>
      );
    }
  }
}

/** Positioned field box on a page (editor + ghost). */
export function EditorFieldBox({
  field,
  color,
  scale,
  selected,
  ghost,
  dragging,
  style,
  onPointerDown,
  onResizePointerDown,
  onClick,
  onFocus,
}: {
  field: EditorField;
  color: string;
  scale: number;
  selected?: boolean;
  ghost?: boolean;
  dragging?: boolean;
  style?: CSSProperties;
  onPointerDown?: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onResizePointerDown?: (e: ReactPointerEvent<HTMLSpanElement>) => void;
  onClick?: (e: ReactMouseEvent<HTMLDivElement>) => void;
  /** keyboard focus (Tab) selects the field; Delete / arrow keys then act on it */
  onFocus?: () => void;
}) {
  return (
    <div
      role={ghost ? undefined : "button"}
      tabIndex={ghost ? undefined : 0}
      aria-label={ghost ? undefined : `${fieldTitle(field)} 입력란`}
      aria-pressed={ghost ? undefined : !!selected}
      data-field-id={ghost ? undefined : field.id}
      onPointerDown={onPointerDown}
      onClick={onClick}
      onFocus={onFocus}
      className={cn(
        "absolute touch-none select-none outline-none",
        ghost ? "pointer-events-none z-30" : "z-10 cursor-move",
        selected && "z-20",
        dragging && "opacity-90",
      )}
      style={{
        left: ghost ? undefined : field.x * scale,
        top: ghost ? undefined : field.y * scale,
        width: field.width * scale,
        height: field.height * scale,
        background: withAlpha(color, ghost ? 0.3 : fieldTint(field.type)),
        border: `1px solid ${color}`,
        boxShadow: selected
          ? "0 0 0 2px var(--emphasis), 0 0 6px 2px color-mix(in srgb, var(--emphasis) 40%, transparent)"
          : undefined,
        ...style,
      }}
    >
      <FieldBoxContent field={field} color={color} scale={scale} />
      {!ghost && (
        <span
          aria-hidden
          onPointerDown={onResizePointerDown}
          className="absolute -bottom-px -right-px flex size-3.5 cursor-nwse-resize items-end justify-end"
        >
          <span className="block size-2" style={{ background: color, clipPath: "polygon(100% 0, 100% 100%, 0 100%)" }} />
        </span>
      )}
    </div>
  );
}
