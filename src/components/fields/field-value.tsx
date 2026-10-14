import { Check } from "lucide-react";

import type { FieldRow } from "@/lib/types";

/**
 * Renders the FILLED value of a field inside its box (no chrome).
 * Parent must be a positioned box of the field's on-screen size; `scale` = px per PDF point.
 */
export function FieldValue({ field, scale }: { field: Pick<FieldRow, "type" | "value" | "options" | "height">; scale: number }) {
  const v = field.value;
  if (!v) return null;
  const fontPt = field.options?.fontSize ?? Math.min(12, Math.max(8, field.height * 0.72));
  switch (field.type) {
    case "signature":
    case "image":
      // eslint-disable-next-line @next/next/no-img-element
      return <img src={v} alt="" className="pointer-events-none size-full object-contain" draggable={false} />;
    case "checkbox":
      return v === "true" ? (
        <span className="flex size-full items-center justify-center text-[#212121]">
          <Check className="size-[90%]" strokeWidth={3} />
        </span>
      ) : null;
    default:
      return (
        <span
          className="pointer-events-none flex size-full items-center overflow-hidden whitespace-nowrap leading-none text-[#292929]"
          style={{ fontSize: fontPt * scale }}
        >
          {v}
        </span>
      );
  }
}
