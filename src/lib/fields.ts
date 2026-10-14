import {
  Calendar,
  CalendarCheck,
  CircleDot,
  Image as ImageIcon,
  List,
  SquareCheck,
  Type,
  type LucideIcon,
} from "lucide-react";
import { PenLine } from "lucide-react";

import type { FieldType } from "./types";

/** Field type metadata. Sizes are in PDF points (A4 = 595 × 842). */
export const FIELD_META: Record<FieldType, { label: string; icon: LucideIcon; w: number; h: number; placeholder?: string }> = {
  signature: { label: "사인·도장", icon: CircleDot, w: 64, h: 64 },
  text: { label: "텍스트", icon: Type, w: 128, h: 16, placeholder: "텍스트" },
  checkbox: { label: "체크박스", icon: SquareCheck, w: 14, h: 14 },
  signed_date: { label: "서명한 날짜", icon: CalendarCheck, w: 128, h: 16, placeholder: "#YYYY-MM-DD" },
  date: { label: "날짜", icon: Calendar, w: 128, h: 16, placeholder: "YYYY-MM-DD" },
  dropdown: { label: "드롭다운", icon: List, w: 128, h: 16, placeholder: "선택" },
  transcribe: { label: "따라쓰기", icon: PenLine, w: 200, h: 40, placeholder: "따라쓰기" },
  image: { label: "이미지", icon: ImageIcon, w: 96, h: 72, placeholder: "이미지" },
};

export const FIELD_ORDER: FieldType[] = ["signature", "text", "checkbox", "signed_date", "date", "dropdown", "transcribe", "image"];

/** Fields the signer has to complete themselves (signed_date is auto-filled). */
export function isUserFillable(type: FieldType) {
  return type !== "signed_date";
}
