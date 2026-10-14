"use client";

import {
  Check,
  Eraser,
  MousePointer2,
  Pencil,
  Redo2,
  Send,
  Trash2,
  Type,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { toast } from "sonner";

import { PdfPageView, PdfThumbnail, readPdfInfo, usePdfDocument } from "@/components/pdf/pdf";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { ConfirmModal, Modal } from "@/components/ui/modal";
import { MAX_PDF_BYTES, paths } from "@/lib/storage";
import type { PageSize } from "@/lib/types";
import { cn } from "@/lib/utils";

import { downloadPdf, loadFontBytes, newId, uploadPdf } from "../../_edit-kit/client";
import {
  BusyOverlay,
  EditorFrame,
  EditorHeader,
  HeaderButton,
  HeaderPrimaryButton,
  ToolButton,
  ToolDivider,
} from "../../_edit-kit/editor-frame";
import { Spinner } from "../../_edit-kit/list-ui";
import { requestSignFromEditing, saveEditingAnnotations } from "../actions";
import {
  ANNOTATION_LABELS,
  FONT_SIZES,
  INK_COLORS,
  MAX_ANNOTATIONS,
  STROKE_WIDTHS,
  TEXT_LINE_HEIGHT,
  type Annotation,
  type DrawAnnotation,
  type TextAnnotation,
} from "../annotations";
import { CHECK_PATH, CHECK_STROKE, flattenAnnotations, strokePath } from "./flatten";

type Tool = "select" | "text" | "whiteout" | "check" | "draw";

/** A4 (595.28pt) is shown 816px wide at 100%. */
const BASE_SCALE = 816 / 595.28;
const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const MIN_SIZE = 8;

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), Math.max(min, max));
const r2 = (n: number) => Math.round(n * 100) / 100;

const TOOLS: { tool: Tool; label: string; icon: React.ReactNode; key: string }[] = [
  { tool: "select", label: "선택", icon: <MousePointer2 />, key: "V" },
  { tool: "text", label: "텍스트", icon: <Type />, key: "T" },
  { tool: "whiteout", label: "화이트아웃", icon: <Eraser />, key: "W" },
  { tool: "check", label: "체크", icon: <Check />, key: "C" },
  { tool: "draw", label: "펜", icon: <Pencil />, key: "P" },
];

interface EditorDoc {
  id: string;
  title: string;
  filePath: string;
  status: "editing" | "done";
  annotations: Annotation[];
}

export function DocumentEditor({ wid, doc, canEdit }: { wid: string; doc: EditorDoc; canEdit: boolean }) {
  const router = useRouter();
  const listHref = `/workspaces/${wid}/esign/requests/editing-documents`;

  /* ------------------------------------------------------------ source PDF */
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    let cancelled = false;
    downloadPdf(doc.filePath)
      .then((b) => !cancelled && setBytes(b))
      .catch(() => !cancelled && setLoadError("문서를 불러오지 못했습니다."));
    return () => {
      cancelled = true;
    };
  }, [doc.filePath, reloadKey]);
  const { doc: pdf, pageSizes, error: pdfError } = usePdfDocument(bytes);
  const error = loadError ?? pdfError;

  /* ----------------------------------------------------------- annotations */
  // `annsRef` mirrors the state synchronously so several updates inside one event
  // (e.g. a text box committing on blur right before a new item is created) compose.
  const [anns, setAnnsState] = useState<Annotation[]>(doc.annotations);
  const annsRef = useRef<Annotation[]>(doc.annotations);
  const setAnns = (next: Annotation[]) => {
    annsRef.current = next;
    setAnnsState(next);
  };
  const updateAnns = (fn: (prev: Annotation[]) => Annotation[]) => setAnns(fn(annsRef.current));
  const [hist, setHist] = useState<{ past: Annotation[][]; future: Annotation[][] }>({ past: [], future: [] });
  const [savedJson, setSavedJson] = useState(() => JSON.stringify(doc.annotations));
  const dirty = useMemo(() => JSON.stringify(anns) !== savedJson, [anns, savedJson]);

  const [tool, setTool] = useState<Tool>("select");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; snapshot: Annotation[] } | null>(null);
  const [liveStroke, setLiveStroke] = useState<{ page: number; pts: number[] } | null>(null);
  // null = fit the page width into the canvas (never above 100%) until the user picks a zoom
  const [zoomChoice, setZoomChoice] = useState<number | null>(null);
  const [canvasWidth, setCanvasWidth] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [textDefaults, setTextDefaults] = useState({ fontSize: 14, color: "#000000" });
  const [inkDefaults, setInkDefaults] = useState({ color: "#000000", strokeWidth: 2 });
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [exitOpen, setExitOpen] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const [status, setStatus] = useState(doc.status);

  const scrollRef = useRef<HTMLDivElement>(null);
  const pageEls = useRef<(HTMLDivElement | null)[]>([]);

  const maxPageW = pageSizes.reduce((m, s) => Math.max(m, s.w), 0);
  const fitZoom = canvasWidth && maxPageW ? Math.min(1, Math.max(0.35, (canvasWidth - 80) / (maxPageW * BASE_SCALE))) : 1;
  const zoom = zoomChoice ?? fitZoom;
  const scale = BASE_SCALE * zoom;
  const selected = anns.find((a) => a.id === selectedId) ?? null;

  const pushHistory = (snapshot: Annotation[]) =>
    setHist((h) => ({ past: [...h.past, snapshot].slice(-100), future: [] }));

  const commit = (next: Annotation[]) => {
    pushHistory(annsRef.current);
    setAnns(next);
  };

  const undo = () => {
    if (!hist.past.length) return;
    const prev = hist.past[hist.past.length - 1];
    setHist({ past: hist.past.slice(0, -1), future: [annsRef.current, ...hist.future] });
    setAnns(prev);
    setSelectedId(null);
    setEditing(null);
  };
  const redo = () => {
    if (!hist.future.length) return;
    const [next, ...rest] = hist.future;
    setHist({ past: [...hist.past, annsRef.current], future: rest });
    setAnns(next);
    setSelectedId(null);
    setEditing(null);
  };

  const removeSelected = () => {
    if (!selected || !canEdit) return;
    commit(annsRef.current.filter((a) => a.id !== selected.id));
    setSelectedId(null);
    setEditing(null);
  };

  const updateSelected = (patch: Partial<Annotation>) => {
    if (!selected || !canEdit) return;
    commit(annsRef.current.map((a) => (a.id === selected.id ? ({ ...a, ...patch } as Annotation) : a)));
  };

  const nudge = (dx: number, dy: number) => {
    if (!selected || !canEdit) return;
    const size = pageSizes[selected.page - 1];
    if (!size) return;
    updateSelected({
      x: r2(clamp(selected.x + dx, 0, size.w - selected.width)),
      y: r2(clamp(selected.y + dy, 0, size.h - selected.height)),
    });
  };

  const canAdd = () => {
    if (annsRef.current.length >= MAX_ANNOTATIONS) {
      toast.error(`편집 항목은 최대 ${MAX_ANNOTATIONS}개까지 추가할 수 있습니다.`);
      return false;
    }
    return true;
  };

  /* ---------------------------------------------------------------- text */
  const startTextEdit = (id: string) => {
    if (!canEdit) return;
    setSelectedId(id);
    setEditing({ id, snapshot: annsRef.current });
  };

  const commitText = (id: string, value: string, heightPx: number) => {
    const session = editing;
    setEditing(null);
    const target = annsRef.current.find((a) => a.id === id);
    if (!target || target.type !== "text") return;
    const snapshot = session?.id === id ? session.snapshot : annsRef.current;
    if (!value.trim()) {
      const next = annsRef.current.filter((a) => a.id !== id);
      // a brand-new empty box disappears without an undo step
      if (snapshot.some((a) => a.id === id)) {
        pushHistory(snapshot);
      }
      setAnns(next);
      setSelectedId(null);
      return;
    }
    if (value === target.text) return;
    const height = r2(Math.max(heightPx / scale, target.fontSize * TEXT_LINE_HEIGHT));
    pushHistory(snapshot);
    setAnns(annsRef.current.map((a) => (a.id === id ? { ...a, text: value, height } : a)));
  };

  /* ------------------------------------------------------------ gestures */
  const onPagePointerDown = (e: ReactPointerEvent<HTMLDivElement>, page: number, size: PageSize) => {
    if (e.button !== 0) return;
    if (!canEdit || tool === "select") {
      setSelectedId(null);
      return;
    }
    e.preventDefault();
    (document.activeElement as HTMLElement | null)?.blur?.();
    if (!canAdd()) return;
    const el = e.currentTarget;
    const toPt = (cx: number, cy: number) => {
      const rect = el.getBoundingClientRect();
      return { x: clamp((cx - rect.left) / scale, 0, size.w), y: clamp((cy - rect.top) / scale, 0, size.h) };
    };
    const start = toPt(e.clientX, e.clientY);
    const snapshot = annsRef.current;

    if (tool === "text") {
      const fs = textDefaults.fontSize;
      const lh = fs * TEXT_LINE_HEIGHT;
      const x = clamp(start.x, 0, size.w - 24);
      const a: TextAnnotation = {
        id: newId(),
        type: "text",
        page,
        x: r2(x),
        y: r2(clamp(start.y - lh / 2, 0, size.h - lh)),
        width: r2(Math.max(24, Math.min(220, size.w - x))),
        height: r2(lh),
        text: "",
        fontSize: fs,
        color: textDefaults.color,
      };
      setAnns([...annsRef.current, a]);
      setSelectedId(a.id);
      setEditing({ id: a.id, snapshot });
      setTool("select");
      return;
    }

    if (tool === "check") {
      const s = 18;
      const a: Annotation = {
        id: newId(),
        type: "check",
        page,
        x: r2(clamp(start.x - s / 2, 0, size.w - s)),
        y: r2(clamp(start.y - s / 2, 0, size.h - s)),
        width: s,
        height: s,
        color: inkDefaults.color,
      };
      commit([...annsRef.current, a]);
      setSelectedId(a.id);
      setTool("select");
      return;
    }

    if (tool === "whiteout") {
      const id = newId();
      setAnns([...annsRef.current, { id, type: "whiteout", page, x: r2(start.x), y: r2(start.y), width: 1, height: 1 }]);
      setSelectedId(id);
      let dragged = false;
      const onMove = (ev: PointerEvent) => {
        const p = toPt(ev.clientX, ev.clientY);
        if (!dragged && Math.hypot(p.x - start.x, p.y - start.y) * scale < 4) return;
        dragged = true;
        const x = Math.min(start.x, p.x);
        const y = Math.min(start.y, p.y);
        updateAnns((prev) =>
          prev.map((a) =>
            a.id === id ? { ...a, x: r2(x), y: r2(y), width: r2(Math.max(1, Math.abs(p.x - start.x))), height: r2(Math.max(1, Math.abs(p.y - start.y))) } : a,
          ),
        );
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        updateAnns((prev) =>
          prev.map((a) => {
            if (a.id !== id) return a;
            if (dragged && a.width >= MIN_SIZE / 2 && a.height >= MIN_SIZE / 2) return a;
            const w = 120;
            const h = 28;
            return { ...a, x: r2(clamp(start.x - w / 2, 0, size.w - w)), y: r2(clamp(start.y - h / 2, 0, size.h - h)), width: w, height: h };
          }),
        );
        pushHistory(snapshot);
        setTool("select");
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      return;
    }

    if (tool === "draw") {
      const pts = [start.x, start.y];
      setLiveStroke({ page, pts: [...pts] });
      const onMove = (ev: PointerEvent) => {
        const p = toPt(ev.clientX, ev.clientY);
        const lx = pts[pts.length - 2];
        const ly = pts[pts.length - 1];
        if (Math.hypot(p.x - lx, p.y - ly) < 1.2 || pts.length >= 8000) return;
        pts.push(p.x, p.y);
        setLiveStroke({ page, pts: [...pts] });
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        setLiveStroke(null);
        if (pts.length === 2) pts.push(pts[0] + 0.5, pts[1] + 0.5);
        const sw = inkDefaults.strokeWidth;
        const pad = sw / 2 + 1;
        const xs = pts.filter((_, i) => i % 2 === 0);
        const ys = pts.filter((_, i) => i % 2 === 1);
        const minX = Math.min(...xs) - pad;
        const minY = Math.min(...ys) - pad;
        const w = Math.max(...xs) + pad - minX;
        const h = Math.max(...ys) + pad - minY;
        const norm = pts.map((v, i) => Math.round(((i % 2 === 0 ? (v - minX) / w : (v - minY) / h) * 10000)) / 10000);
        const a: DrawAnnotation = {
          id: newId(),
          type: "draw",
          page,
          x: r2(minX),
          y: r2(minY),
          width: r2(w),
          height: r2(h),
          color: inkDefaults.color,
          strokeWidth: sw,
          points: norm,
        };
        pushHistory(snapshot);
        updateAnns((prev) => [...prev, a]);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    }
  };

  const onAnnotationPointerDown = (e: ReactPointerEvent<HTMLDivElement>, a: Annotation) => {
    if (e.button !== 0 || tool !== "select") return;
    e.stopPropagation();
    if (editing?.id === a.id) return;
    setSelectedId(a.id);
    if (!canEdit) return;
    e.preventDefault();
    (document.activeElement as HTMLElement | null)?.blur?.();
    const size = pageSizes[a.page - 1];
    if (!size) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const snapshot = annsRef.current;
    let moved = false;
    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / scale;
      const dy = (ev.clientY - startY) / scale;
      if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 3) return;
      moved = true;
      updateAnns((prev) =>
        prev.map((p) =>
          p.id === a.id ? { ...p, x: r2(clamp(a.x + dx, 0, size.w - p.width)), y: r2(clamp(a.y + dy, 0, size.h - p.height)) } : p,
        ),
      );
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (moved) pushHistory(snapshot);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const onResizePointerDown = (e: ReactPointerEvent<HTMLSpanElement>, a: Annotation) => {
    if (e.button !== 0 || !canEdit) return;
    e.stopPropagation();
    e.preventDefault();
    const size = pageSizes[a.page - 1];
    if (!size) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const snapshot = annsRef.current;
    let moved = false;
    const onMove = (ev: PointerEvent) => {
      moved = true;
      const dx = (ev.clientX - startX) / scale;
      const dy = (ev.clientY - startY) / scale;
      updateAnns((prev) =>
        prev.map((p) => {
          if (p.id !== a.id) return p;
          if (p.type === "text") return { ...p, width: r2(clamp(a.width + dx, 24, size.w - p.x)) };
          if (p.type === "check") {
            const s = clamp(Math.max(a.width + dx, a.height + dy), MIN_SIZE, Math.min(size.w - p.x, size.h - p.y));
            return { ...p, width: r2(s), height: r2(s) };
          }
          return {
            ...p,
            width: r2(clamp(a.width + dx, MIN_SIZE, size.w - p.x)),
            height: r2(clamp(a.height + dy, MIN_SIZE, size.h - p.y)),
          };
        }),
      );
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (moved) pushHistory(snapshot);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  /* --------------------------------------------------------------- save */
  const save = async (): Promise<boolean> => {
    if (!canEdit) return true;
    const all = annsRef.current;
    const snapshot = all.filter((a) => a.type !== "text" || a.text.trim());
    setSaving(true);
    const res = await saveEditingAnnotations({ wid, id: doc.id, annotations: snapshot, pageCount: pageSizes.length });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error);
      return false;
    }
    setSavedJson(JSON.stringify(all));
    setStatus("editing");
    return true;
  };

  const onSaveClick = async () => {
    if (await save()) toast.success("저장했습니다.");
  };

  const exit = () => {
    if (canEdit && dirty) setExitOpen(true);
    else router.push(listHref);
  };

  const requestSign = async () => {
    setRequestOpen(false);
    if (!bytes || !pageSizes.length) return;
    setBusy("편집 내용을 반영한 PDF를 만드는 중…");
    try {
      if (canEdit && dirty && !(await save())) throw new Error("편집 내용을 저장하지 못했습니다.");
      const usable = annsRef.current.filter((a) => a.type !== "text" || a.text.trim());
      const out = await flattenAnnotations(bytes, usable, () => loadFontBytes("regular"));
      if (out.byteLength > MAX_PDF_BYTES) throw new Error("편집된 PDF가 10MB를 넘어 서명 요청할 수 없습니다.");
      const info = await readPdfInfo(out.slice().buffer as ArrayBuffer);
      setBusy("서명 요청 문서를 만드는 중…");
      const docId = newId();
      const uploadError = await uploadPdf(paths.documentOriginal(wid, docId), out);
      if (uploadError) throw new Error("PDF를 업로드하지 못했습니다.");
      const res = await requestSignFromEditing({ wid, id: doc.id, docId, pageCount: info.pageCount, pageSizes: info.pageSizes });
      if (!res.ok) throw new Error(res.error);
      setSavedJson(JSON.stringify(annsRef.current));
      router.push(`/workspaces/${wid}/documents/d/${res.docId}/steps/1`);
    } catch (e) {
      setBusy(null);
      toast.error((e as Error).message || "서명 요청 문서를 만들지 못했습니다.");
    }
  };

  /* ------------------------------------------------------------ keyboard */
  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
    if (busy || exitOpen || requestOpen) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "s") {
      e.preventDefault();
      if (canEdit && dirty && !saving) void onSaveClick();
      return;
    }
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
    if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if (mod && e.key.toLowerCase() === "y") {
      e.preventDefault();
      redo();
      return;
    }
    if (mod) return;
    switch (e.key) {
      case "Delete":
      case "Backspace":
        if (selected) {
          e.preventDefault();
          removeSelected();
        }
        return;
      case "Escape":
        setSelectedId(null);
        setTool("select");
        return;
      case "Enter":
        if (selected?.type === "text") {
          e.preventDefault();
          startTextEdit(selected.id);
        }
        return;
      case "ArrowLeft":
      case "ArrowRight":
      case "ArrowUp":
      case "ArrowDown": {
        if (!selected) return;
        e.preventDefault();
        const d = e.shiftKey ? 10 : 1;
        nudge(e.key === "ArrowLeft" ? -d : e.key === "ArrowRight" ? d : 0, e.key === "ArrowUp" ? -d : e.key === "ArrowDown" ? d : 0);
        return;
      }
    }
    if (!canEdit) return;
    const found = TOOLS.find((x) => x.key.toLowerCase() === e.key.toLowerCase());
    if (found) setTool(found.tool);
  });
  useEffect(() => {
    const h = (e: KeyboardEvent) => onKeyDown(e);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  useEffect(() => {
    if (!dirty || !canEdit) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty, canEdit]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => setCanvasWidth(entries[0]?.contentRect.width ?? 0));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* -------------------------------------------------------------- render */
  const onScroll = () => {
    const box = scrollRef.current;
    if (!box) return;
    const mid = box.scrollTop + box.clientHeight / 3;
    let p = 1;
    pageEls.current.forEach((el, i) => {
      if (el && el.offsetTop <= mid) p = i + 1;
    });
    setCurrentPage(p);
  };
  const scrollToPage = (n: number) => {
    pageEls.current[n - 1]?.scrollIntoView({ behavior: "smooth", block: "start" });
    setCurrentPage(n);
  };

  const zoomOutTo = [...ZOOMS].reverse().find((z) => z < zoom - 0.001);
  const zoomInTo = ZOOMS.find((z) => z > zoom + 0.001);
  const cursor = !canEdit || tool === "select" ? "" : tool === "text" ? "cursor-text" : "cursor-crosshair";

  return (
    <EditorFrame>
      <EditorHeader
        onExit={exit}
        title={doc.title}
        status={
          <div className="flex shrink-0 items-center gap-2">
            {!canEdit ? (
              <StatusBadge tone="neutral" dot={false}>
                읽기 전용
              </StatusBadge>
            ) : status === "done" && !dirty ? (
              <StatusBadge tone="positive">편집 완료</StatusBadge>
            ) : (
              <StatusBadge tone="emphasis">편집 중</StatusBadge>
            )}
            {canEdit && dirty && <span className="text-[13px] text-fg-muted">저장하지 않은 변경 사항</span>}
          </div>
        }
      >
        {canEdit && (
          <HeaderButton onClick={onSaveClick} disabled={!dirty || saving}>
            {saving ? "저장 중…" : "저장"}
          </HeaderButton>
        )}
        <HeaderPrimaryButton icon={<Send className="size-4 -rotate-12" fill="currentColor" />} disabled={!pdf || !!busy} onClick={() => setRequestOpen(true)}>
          서명 요청하기
        </HeaderPrimaryButton>
      </EditorHeader>

      {/* toolbar */}
      <div className="flex h-12 shrink-0 items-center justify-center gap-1 border-b border-line bg-menu px-4" role="toolbar" aria-label="편집 도구">
        {TOOLS.map((t) => (
          <ToolButton
            key={t.tool}
            label={t.label}
            icon={t.icon}
            shortcut={t.key}
            active={tool === t.tool}
            disabled={!canEdit && t.tool !== "select"}
            onClick={() => {
              setTool(t.tool);
              if (t.tool !== "select") setSelectedId(null);
            }}
          />
        ))}
        <ToolDivider />
        <ToolButton label="실행 취소" icon={<Undo2 />} showLabel={false} shortcut="Ctrl+Z" disabled={!hist.past.length} onClick={undo} />
        <ToolButton label="다시 실행" icon={<Redo2 />} showLabel={false} shortcut="Ctrl+Shift+Z" disabled={!hist.future.length} onClick={redo} />
        <ToolDivider />
        <ToolButton label="축소" icon={<ZoomOut />} showLabel={false} disabled={zoomOutTo == null} onClick={() => zoomOutTo != null && setZoomChoice(zoomOutTo)} />
        <button
          type="button"
          onClick={() => setZoomChoice(1)}
          title="100%로 보기"
          className="h-9 w-14 rounded-lg text-[13px] font-medium text-fg-2 hover:bg-menu-hover"
        >
          {Math.round(zoom * 100)}%
        </button>
        <ToolButton label="확대" icon={<ZoomIn />} showLabel={false} disabled={zoomInTo == null} onClick={() => zoomInTo != null && setZoomChoice(zoomInTo)} />
        <ToolDivider />
        <ToolButton label="삭제" icon={<Trash2 />} showLabel={false} shortcut="Delete" disabled={!selected || !canEdit} onClick={removeSelected} />
      </div>

      <div className="flex min-h-0 flex-1">
        {/* page thumbnails */}
        <aside className="hidden w-[180px] shrink-0 overflow-y-auto border-r border-line bg-surface-2 px-4 py-5 lg:block" aria-label="페이지 목록">
          <p className="mb-3 text-[13px] font-medium text-fg-muted">페이지 {pageSizes.length ? `(${pageSizes.length})` : ""}</p>
          <div className="flex flex-col items-center gap-4">
            {pageSizes.map((_, i) => (
              <div key={i} className="flex flex-col items-center gap-1.5">
                <PdfThumbnail doc={pdf} pageNumber={i + 1} width={110} active={currentPage === i + 1} onClick={() => scrollToPage(i + 1)} />
                <span className={cn("text-xs", currentPage === i + 1 ? "font-bold text-fg" : "text-fg-muted")}>{i + 1}</span>
              </div>
            ))}
          </div>
        </aside>

        {/* pages */}
        <div ref={scrollRef} onScroll={onScroll} className="relative min-w-0 flex-1 overflow-auto">
          {error ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-fg-muted">
              <p>{error}</p>
              <Button
                variant="light"
                onClick={() => {
                  setLoadError(null);
                  setBytes(null);
                  setReloadKey((k) => k + 1);
                }}
              >
                다시 시도
              </Button>
            </div>
          ) : !pdf ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-fg-muted">
              <Spinner />
              문서를 불러오는 중…
            </div>
          ) : (
            <div className="mx-auto flex w-max min-w-full flex-col items-center gap-6 px-10 py-8">
              {pageSizes.map((size, i) => {
                const page = i + 1;
                const width = size.w * scale;
                return (
                  <div
                    key={page}
                    ref={(el) => {
                      pageEls.current[i] = el;
                    }}
                    className="flex flex-col items-center"
                  >
                    <PdfPageView doc={pdf} pageNumber={page} width={width}>
                      <div className={cn("absolute inset-0 touch-none select-none", cursor)} onPointerDown={(e) => onPagePointerDown(e, page, size)}>
                        {anns
                          .filter((a) => a.page === page)
                          .map((a) => (
                            <AnnotationView
                              key={a.id}
                              a={a}
                              scale={scale}
                              selected={selectedId === a.id}
                              editing={editing?.id === a.id}
                              interactive={tool === "select"}
                              canEdit={canEdit}
                              onPointerDown={(e) => onAnnotationPointerDown(e, a)}
                              onResizePointerDown={(e) => onResizePointerDown(e, a)}
                              onDoubleClick={() => a.type === "text" && startTextEdit(a.id)}
                              onCommitText={(value, h) => commitText(a.id, value, h)}
                            />
                          ))}
                        {liveStroke?.page === page && (
                          <svg className="pointer-events-none absolute inset-0 size-full overflow-visible" aria-hidden>
                            <polyline
                              points={liveStroke.pts.map((v) => v * scale).join(" ")}
                              fill="none"
                              stroke={inkDefaults.color}
                              strokeWidth={inkDefaults.strokeWidth * scale}
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        )}
                      </div>
                    </PdfPageView>
                    <span className="mt-2 text-xs text-fg-muted">
                      {page} / {pageSizes.length}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* properties */}
        <aside className="w-[240px] shrink-0 overflow-y-auto border-l border-line bg-surface" aria-label="속성">
          <PropertiesPanel
            selected={selected}
            tool={tool}
            canEdit={canEdit}
            textDefaults={textDefaults}
            inkDefaults={inkDefaults}
            onTextDefaults={setTextDefaults}
            onInkDefaults={setInkDefaults}
            onChange={updateSelected}
            onDelete={removeSelected}
            onEditText={() => selected && startTextEdit(selected.id)}
            count={anns.length}
          />
        </aside>
      </div>

      <Modal
        open={exitOpen}
        onClose={() => setExitOpen(false)}
        width={420}
        footerAlign="center"
        footer={
          <>
            <Button variant="light" size="lg" onClick={() => router.push(listHref)}>
              저장하지 않고 나가기
            </Button>
            <Button
              variant="primary"
              size="lg"
              disabled={saving}
              onClick={async () => {
                if (await save()) router.push(listHref);
              }}
            >
              {saving ? "저장 중…" : "저장 후 나가기"}
            </Button>
          </>
        }
      >
        <div className="px-8 pb-2 pt-8 text-center">
          <h2 className="text-lg font-bold text-fg">저장하지 않은 변경 사항이 있습니다.</h2>
          <p className="mt-3 text-sm leading-relaxed text-fg-2">편집한 내용을 저장하고 나갈까요?</p>
        </div>
      </Modal>

      <ConfirmModal
        open={requestOpen}
        onClose={() => setRequestOpen(false)}
        onConfirm={() => void requestSign()}
        title="서명 요청을 시작할까요?"
        description={
          <>
            편집한 내용을 반영한 PDF로 새 서명 요청 문서를 만듭니다.
            <br />
            원본 편집 문서는 그대로 남아 있어 다시 편집할 수 있어요.
          </>
        }
        confirmLabel="서명 요청하기"
      />

      {busy && <BusyOverlay message={busy} />}
    </EditorFrame>
  );
}

/* ====================================================================== */

function AnnotationView({
  a,
  scale,
  selected,
  editing,
  interactive,
  canEdit,
  onPointerDown,
  onResizePointerDown,
  onDoubleClick,
  onCommitText,
}: {
  a: Annotation;
  scale: number;
  selected: boolean;
  editing: boolean;
  interactive: boolean;
  canEdit: boolean;
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onResizePointerDown: (e: ReactPointerEvent<HTMLSpanElement>) => void;
  onDoubleClick: () => void;
  onCommitText: (value: string, heightPx: number) => void;
}) {
  const isText = a.type === "text";
  return (
    <div
      role="button"
      tabIndex={-1}
      aria-label={ANNOTATION_LABELS[a.type]}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      className={cn(
        "absolute",
        interactive ? "pointer-events-auto" : "pointer-events-none",
        interactive && canEdit && !editing && "cursor-move",
        selected ? "outline outline-2 outline-offset-1 outline-emphasis" : interactive && "hover:outline hover:outline-1 hover:outline-offset-1 hover:outline-emphasis/60",
      )}
      style={{
        left: a.x * scale,
        top: a.y * scale,
        width: a.width * scale,
        height: isText ? undefined : a.height * scale,
        minHeight: isText ? a.fontSize * TEXT_LINE_HEIGHT * scale : undefined,
      }}
    >
      {a.type === "text" &&
        (editing ? (
          <textarea
            ref={(el) => {
              if (el && document.activeElement !== el) {
                el.style.height = `${el.scrollHeight}px`;
                el.focus();
                el.setSelectionRange(el.value.length, el.value.length);
              }
            }}
            defaultValue={a.text}
            rows={1}
            aria-label="텍스트 입력"
            placeholder="텍스트 입력"
            spellCheck={false}
            onPointerDown={(e) => e.stopPropagation()}
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = "auto";
              el.style.height = `${el.scrollHeight}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
            onBlur={(e) => onCommitText(e.currentTarget.value, e.currentTarget.scrollHeight)}
            className="block w-full resize-none overflow-hidden border-0 bg-emphasis/5 p-0 outline-none placeholder:text-fg-disabled"
            style={{
              fontSize: a.fontSize * scale,
              lineHeight: TEXT_LINE_HEIGHT,
              color: a.color,
              whiteSpace: "pre-wrap",
              wordBreak: "keep-all",
              overflowWrap: "anywhere",
            }}
          />
        ) : (
          <div
            className="whitespace-pre-wrap"
            style={{ fontSize: a.fontSize * scale, lineHeight: TEXT_LINE_HEIGHT, color: a.color, wordBreak: "keep-all", overflowWrap: "anywhere" }}
          >
            {a.text}
          </div>
        ))}

      {a.type === "whiteout" && (
        <div className="absolute inset-0 bg-page">
          {!selected && <div className="absolute inset-0 border border-dashed border-line-strong" />}
        </div>
      )}

      {a.type === "check" && (
        <svg viewBox="0 0 24 24" className="absolute inset-0 size-full" aria-hidden>
          <path d={CHECK_PATH} fill="none" stroke={a.color} strokeWidth={CHECK_STROKE} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}

      {a.type === "draw" && (
        <svg viewBox={`0 0 ${a.width} ${a.height}`} preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible" aria-hidden>
          <path
            d={strokePath(a.points, a.width, a.height)}
            fill="none"
            stroke={a.color}
            strokeWidth={a.strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}

      {selected && canEdit && !editing && (
        <span
          role="presentation"
          onPointerDown={onResizePointerDown}
          className={cn(
            "absolute z-10 rounded-sm border-2 border-white bg-emphasis",
            isText ? "-right-[7px] top-1/2 h-4 w-2.5 -translate-y-1/2 cursor-ew-resize" : "-bottom-[7px] -right-[7px] size-3 cursor-nwse-resize",
          )}
        />
      )}
    </div>
  );
}

/* ====================================================================== */

function Swatches({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="색상">
      {INK_COLORS.map((c) => (
        <button
          key={c.value}
          type="button"
          role="radio"
          aria-checked={value === c.value}
          aria-label={c.label}
          title={c.label}
          disabled={disabled}
          onClick={() => onChange(c.value)}
          className={cn(
            "size-6 rounded-full border border-line-strong transition-shadow disabled:opacity-50",
            value === c.value && "ring-2 ring-emphasis ring-offset-2 ring-offset-surface",
          )}
          style={{ background: c.value }}
        />
      ))}
    </div>
  );
}

function PanelSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-line-light px-4 py-4">
      <h3 className="mb-3 text-[13px] font-medium text-fg-muted">{title}</h3>
      {children}
    </section>
  );
}

function PropertiesPanel({
  selected,
  tool,
  canEdit,
  textDefaults,
  inkDefaults,
  onTextDefaults,
  onInkDefaults,
  onChange,
  onDelete,
  onEditText,
  count,
}: {
  selected: Annotation | null;
  tool: Tool;
  canEdit: boolean;
  textDefaults: { fontSize: number; color: string };
  inkDefaults: { color: string; strokeWidth: number };
  onTextDefaults: (v: { fontSize: number; color: string }) => void;
  onInkDefaults: (v: { color: string; strokeWidth: number }) => void;
  onChange: (patch: Partial<Annotation>) => void;
  onDelete: () => void;
  onEditText: () => void;
  count: number;
}) {
  if (selected) {
    return (
      <div>
        <div className="flex h-[55px] items-center justify-between border-b border-line-light bg-emphasis-bg/40 px-4">
          <p className="text-sm font-bold text-fg">{ANNOTATION_LABELS[selected.type]}</p>
          {canEdit && (
            <button type="button" aria-label="삭제" title="삭제" onClick={onDelete} className="flex size-8 items-center justify-center rounded text-icon-2 hover:bg-btn-light">
              <Trash2 className="size-4" />
            </button>
          )}
        </div>
        {selected.type === "text" && (
          <>
            <PanelSection title="글자 크기">
              <Select
                wrapperClassName="w-full"
                value={selected.fontSize}
                disabled={!canEdit}
                aria-label="글자 크기"
                onChange={(e) => {
                  const fontSize = Number(e.target.value);
                  onChange({ fontSize });
                  onTextDefaults({ ...textDefaults, fontSize });
                }}
              >
                {[...new Set([...FONT_SIZES, selected.fontSize])].sort((x, y) => x - y).map((n) => (
                  <option key={n} value={n}>
                    {n}pt
                  </option>
                ))}
              </Select>
            </PanelSection>
            <PanelSection title="글자 색">
              <Swatches
                value={selected.color}
                disabled={!canEdit}
                onChange={(color) => {
                  onChange({ color });
                  onTextDefaults({ ...textDefaults, color });
                }}
              />
            </PanelSection>
            {canEdit && (
              <div className="px-4 py-4">
                <Button variant="light" className="w-full" onClick={onEditText}>
                  내용 편집
                </Button>
                <p className="mt-2 text-xs leading-relaxed text-fg-muted">더블 클릭하거나 Enter 키를 눌러도 내용을 편집할 수 있어요.</p>
              </div>
            )}
          </>
        )}
        {selected.type === "check" && (
          <PanelSection title="색상">
            <Swatches
              value={selected.color}
              disabled={!canEdit}
              onChange={(color) => {
                onChange({ color });
                onInkDefaults({ ...inkDefaults, color });
              }}
            />
          </PanelSection>
        )}
        {selected.type === "draw" && (
          <>
            <PanelSection title="색상">
              <Swatches
                value={selected.color}
                disabled={!canEdit}
                onChange={(color) => {
                  onChange({ color });
                  onInkDefaults({ ...inkDefaults, color });
                }}
              />
            </PanelSection>
            <PanelSection title="굵기">
              <StrokePicker value={selected.strokeWidth} disabled={!canEdit} onChange={(strokeWidth) => onChange({ strokeWidth })} />
            </PanelSection>
          </>
        )}
        {selected.type === "whiteout" && (
          <p className="px-4 py-4 text-[13px] leading-relaxed text-fg-muted">
            흰색 상자로 문서의 기존 내용을 가립니다. 모서리를 끌어 크기를 조절하고, 위에 텍스트를 올려 내용을 고칠 수 있어요.
          </p>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="flex h-[55px] items-center border-b border-line-light px-4">
        <p className="text-sm font-bold text-fg">편집 도구</p>
        <span className="ml-auto text-xs text-fg-muted">{count}개 항목</span>
      </div>
      {canEdit && tool === "text" && (
        <>
          <PanelSection title="새 텍스트 글자 크기">
            <Select
              wrapperClassName="w-full"
              value={textDefaults.fontSize}
              aria-label="새 텍스트 글자 크기"
              onChange={(e) => onTextDefaults({ ...textDefaults, fontSize: Number(e.target.value) })}
            >
              {FONT_SIZES.map((n) => (
                <option key={n} value={n}>
                  {n}pt
                </option>
              ))}
            </Select>
          </PanelSection>
          <PanelSection title="새 텍스트 글자 색">
            <Swatches value={textDefaults.color} onChange={(color) => onTextDefaults({ ...textDefaults, color })} />
          </PanelSection>
        </>
      )}
      {canEdit && (tool === "draw" || tool === "check") && (
        <>
          <PanelSection title="색상">
            <Swatches value={inkDefaults.color} onChange={(color) => onInkDefaults({ ...inkDefaults, color })} />
          </PanelSection>
          {tool === "draw" && (
            <PanelSection title="굵기">
              <StrokePicker value={inkDefaults.strokeWidth} onChange={(strokeWidth) => onInkDefaults({ ...inkDefaults, strokeWidth })} />
            </PanelSection>
          )}
        </>
      )}
      <ul className="space-y-3 px-4 py-4 text-[13px] leading-relaxed text-fg-muted">
        {canEdit ? (
          <>
            <li>
              <b className="font-medium text-fg-2">텍스트</b> 문서 위를 클릭해 글자를 입력해요.
            </li>
            <li>
              <b className="font-medium text-fg-2">화이트아웃</b> 끌어서 기존 내용을 흰색으로 가려요.
            </li>
            <li>
              <b className="font-medium text-fg-2">체크</b> 클릭한 위치에 체크 표시를 넣어요.
            </li>
            <li>
              <b className="font-medium text-fg-2">펜</b> 끌어서 자유롭게 그려요.
            </li>
            <li>선택한 항목은 끌어서 옮기고, 모서리로 크기를 바꾸고, Delete 키로 지울 수 있어요.</li>
          </>
        ) : (
          <li>문서를 만든 멤버 또는 관리자만 편집할 수 있어요. 현재 편집 내용으로 서명 요청은 할 수 있습니다.</li>
        )}
      </ul>
    </div>
  );
}

function StrokePicker({ value, onChange, disabled }: { value: number; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <div className="flex gap-1.5" role="radiogroup" aria-label="굵기">
      {STROKE_WIDTHS.map((w) => (
        <button
          key={w}
          type="button"
          role="radio"
          aria-checked={value === w}
          aria-label={`${w}pt`}
          title={`${w}pt`}
          disabled={disabled}
          onClick={() => onChange(w)}
          className={cn(
            "flex h-9 flex-1 items-center justify-center rounded border transition-colors disabled:opacity-50",
            value === w ? "border-emphasis bg-emphasis-bg" : "border-line-strong hover:bg-btn-light",
          )}
        >
          <span className="w-5 rounded-full bg-fg-2" style={{ height: Math.max(1, w) }} />
        </button>
      ))}
    </div>
  );
}
