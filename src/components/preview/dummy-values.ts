/**
 * Dummy values of the preview mode (see src/lib/preview/DESIGN.md): what the "자동 입력 (미리보기)"
 * button and the "모든 서명자 서명 완료 처리 (미리보기)" action put into a signer's fields.
 * Client-safe (no server imports) — used by the signer page and by the preview server actions.
 */
import { isValidEmail } from "@/lib/email/address";
import type { FieldOptions, FieldType } from "@/lib/types";

/** Original scribble "signature" (240×80 PNG, black ink on transparent) generated for the preview. */
export const PREVIEW_SIGNATURE_PNG =
  "data:image/png;base64,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";

export const PREVIEW_TEXT = "미리보기 입력";
const PREVIEW_EMAIL = "signer@example.com";

/** Value that satisfies the signer-flow validation for a field of this type / options. */
export function previewFieldValue(
  f: { type: FieldType; options: FieldOptions },
  who: { name: string; email?: string | null; today: string },
): string {
  switch (f.type) {
    case "signature":
    case "image":
      return PREVIEW_SIGNATURE_PNG;
    case "checkbox":
      return "true";
    case "date":
    case "signed_date":
      return who.today;
    case "dropdown":
      return (f.options.items ?? []).find((i) => typeof i === "string" && i.length > 0) ?? "";
    case "transcribe":
      return (f.options.sentence ?? "").replace(/\s+/g, " ").trim() || PREVIEW_TEXT;
    case "text": {
      if (f.options.autoFill === "name" && who.name.trim()) return who.name.trim();
      switch (f.options.format) {
        case "number":
          return "12345";
        case "email":
          return who.email && isValidEmail(who.email) ? who.email : PREVIEW_EMAIL;
        case "phone":
          return "010-1234-5678";
        default:
          return PREVIEW_TEXT;
      }
    }
  }
}
