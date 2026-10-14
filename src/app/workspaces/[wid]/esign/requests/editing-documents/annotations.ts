/**
 * 문서 편집기 annotations — stored in `editing_documents.annotations` (jsonb).
 * Coordinates are PDF points from the top-left of the (displayed, i.e. rotation applied) page.
 * Shared by the browser editor and the server action that validates saves.
 */

interface AnnotationBase {
  id: string;
  /** 1-based page number */
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TextAnnotation extends AnnotationBase {
  type: "text";
  text: string;
  fontSize: number;
  color: string;
}

export interface WhiteoutAnnotation extends AnnotationBase {
  type: "whiteout";
}

export interface CheckAnnotation extends AnnotationBase {
  type: "check";
  color: string;
}

export interface DrawAnnotation extends AnnotationBase {
  type: "draw";
  color: string;
  strokeWidth: number;
  /** flat [x0, y0, x1, y1, …] normalised to the box (0..1) */
  points: number[];
}

export type Annotation = TextAnnotation | WhiteoutAnnotation | CheckAnnotation | DrawAnnotation;
export type AnnotationType = Annotation["type"];

export const ANNOTATION_LABELS: Record<AnnotationType, string> = {
  text: "텍스트",
  whiteout: "화이트아웃",
  check: "체크",
  draw: "펜",
};

/** Ink colours offered for text / check / pen (document content colours). */
export const INK_COLORS = [
  { value: "#000000", label: "검정" },
  { value: "#666666", label: "회색" },
  { value: "#e42929", label: "빨강" },
  { value: "#286fed", label: "파랑" },
  { value: "#00a77f", label: "초록" },
  { value: "#ff8515", label: "주황" },
] as const;

export const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 64];
export const STROKE_WIDTHS = [1, 2, 3, 4, 6];
export const TEXT_LINE_HEIGHT = 1.3;

export const MAX_ANNOTATIONS = 500;
const MAX_TEXT = 5000;
const MAX_POINTS = 4000;

const num = (v: unknown, min: number, max: number, fallback: number) => {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};
const round = (n: number) => Math.round(n * 100) / 100;
const color = (v: unknown) => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : "#000000");
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Validates and normalises untrusted annotation JSON. Returns null when the payload is not an
 * array or is too large; individual malformed entries are dropped.
 */
export function parseAnnotations(input: unknown, pageCount = 10000): Annotation[] | null {
  if (!Array.isArray(input) || input.length > MAX_ANNOTATIONS) return null;
  const out: Annotation[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const id = typeof r.id === "string" && ID_RE.test(r.id) && !seen.has(r.id) ? r.id : null;
    if (!id) continue;
    const page = Math.round(num(r.page, 1, pageCount, 1));
    const base = {
      id,
      page,
      x: round(num(r.x, -1000, 20000, 0)),
      y: round(num(r.y, -1000, 20000, 0)),
      width: round(num(r.width, 1, 20000, 10)),
      height: round(num(r.height, 1, 20000, 10)),
    };
    switch (r.type) {
      case "text": {
        const text = typeof r.text === "string" ? r.text.slice(0, MAX_TEXT) : "";
        if (!text.trim()) continue;
        out.push({ ...base, type: "text", text, fontSize: round(num(r.fontSize, 4, 200, 14)), color: color(r.color) });
        break;
      }
      case "whiteout":
        out.push({ ...base, type: "whiteout" });
        break;
      case "check":
        out.push({ ...base, type: "check", color: color(r.color) });
        break;
      case "draw": {
        if (!Array.isArray(r.points)) continue;
        const pts = r.points.slice(0, MAX_POINTS * 2).map((p) => Math.round(num(p, 0, 1, 0) * 10000) / 10000);
        if (pts.length < 4 || pts.length % 2 !== 0) continue;
        out.push({ ...base, type: "draw", color: color(r.color), strokeWidth: round(num(r.strokeWidth, 0.5, 20, 2)), points: pts });
        break;
      }
      default:
        continue;
    }
    seen.add(id);
  }
  return out;
}
