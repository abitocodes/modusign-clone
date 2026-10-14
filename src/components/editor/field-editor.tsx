"use client";

/**
 * Field placement editor (서명 요청 2단계 "입력란 배치", 템플릿 편집기).
 *
 *  ┌──────────── toolbar: undo · redo | zoom − + ────────────┐
 *  │ tools (240) │  pages (PdfPageView, 816px × zoom)  │ props (240) │
 *  └──────────────────────────────────────────────────────────┘
 *
 * Controlled: `value` is the list of fields (PDF points, top-left origin), every
 * change is reported through `onChange`. Undo/redo history is kept internally.
 */

import { ArrowRightLeft, ChevronDown, ChevronUp, CircleMinus, CirclePlus, LoaderCircle, Plus, Redo2, TriangleAlert, Undo2 } from "lucide-react";
import { usePathname } from "next/navigation";
import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { toast } from "sonner";

import { PdfPageView, usePdfDocument } from "@/components/pdf/pdf";
import { createClient } from "@/lib/supabase/client";
import { cn, participantColor } from "@/lib/utils";

import {
  BASE_SCALE,
  ZOOM_STEPS,
  clamp,
  clampToPage,
  createFieldFromTool,
  minSize,
  newFieldId,
  round2,
  toolTemplate,
  type ArmedTool,
  type EditorCustomField,
  type EditorField,
  type EditorParticipant,
  type FieldOptions,
  type PageSize,
} from "./editor-model";
import { EditorFieldBox } from "./field-box";
import { PropertiesPanel } from "./properties-panel";
import { ToolPanel, type ToolActivate } from "./tool-panel";

export type {
  EditorCustomField,
  EditorField,
  EditorParticipant,
  FieldOptions,
  FieldType,
  PageSize,
  ToolSpec,
} from "./editor-model";
export {
  BASE_SCALE,
  createFieldFromTool,
  fieldPlaceholder,
  fieldTitle,
  newFieldId,
  toolTemplate,
  validateFields,
} from "./editor-model";
export { EditorFieldBox, FieldBoxContent } from "./field-box";

export interface FieldEditorProps {
  /** URL (signed) of the PDF being edited */
  pdfUrl: string;
  /** page sizes in PDF points (fallback until the PDF is loaded) */
  pageSizes: PageSize[];
  participants: EditorParticipant[];
  value: EditorField[];
  onChange(next: EditorField[]): void;
  /**
   * Workspace 맞춤 입력란 for the "자동 입력" tab. When omitted they are loaded on demand
   * for the workspace in the current URL (/workspaces/<id>/…).
   */
  customFields?: EditorCustomField[];
  /** name shown in the right panel's 문서 section (e.g. the uploaded file name) */
  documentName?: string;
  className?: string;
}

const UNKNOWN_COLOR = "#a3a3a3";
const HISTORY_LIMIT = 100;
const DRAG_THRESHOLD = 3;

interface DragState {
  mode: "move" | "resize";
  id: string;
  startX: number;
  startY: number;
  /** grab offset inside the field (points) for move */
  grabX: number;
  grabY: number;
  orig: EditorField;
  current: EditorField;
  moved: boolean;
}

interface History {
  past: EditorField[][];
  future: EditorField[][];
}

const EMPTY_HISTORY: History = { past: [], future: [] };

function isTypingTarget(t: EventTarget | null) {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable) return true;
  if (t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return true;
  if (t instanceof HTMLInputElement) return !["checkbox", "radio", "button", "submit", "reset", "range", "color"].includes(t.type);
  return false;
}

function samePatch<T extends object>(base: T, patch: Partial<T>) {
  return (Object.keys(patch) as (keyof T)[]).every((k) => {
    const a = base[k];
    const b = patch[k];
    if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => v === b[i]);
    return a === b;
  });
}

function ToolbarButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-10 items-center justify-center rounded-xl text-icon-2 transition-colors hover:bg-btn-hover disabled:text-line-strong disabled:hover:bg-transparent [&_svg]:size-5"
    >
      {children}
    </button>
  );
}

/** Loads the workspace's 맞춤 입력란 (custom_fields) with the browser client, once, on demand. */
function useCustomFields(provided: EditorCustomField[] | undefined) {
  const pathname = usePathname();
  const workspaceId = /^\/workspaces\/([^/]+)/.exec(pathname ?? "")?.[1] ?? null;
  const [requested, setRequested] = useState(false);
  const [loaded, setLoaded] = useState<EditorCustomField[] | null>(null);

  useEffect(() => {
    if (provided || !requested || !workspaceId) return;
    let cancelled = false;
    createClient()
      .from("custom_fields")
      .select("id, name, type, required, placeholder, default_value, options")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: true })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) toast.error("맞춤 입력란을 불러오지 못했습니다.");
        setLoaded((data ?? []) as EditorCustomField[]);
      });
    return () => {
      cancelled = true;
    };
  }, [provided, requested, workspaceId]);

  return {
    customFields: provided ?? (workspaceId ? loaded : []),
    request: () => setRequested(true),
    href: workspaceId ? `/workspaces/${workspaceId}/esign/requests/custom-fields` : null,
  };
}

export function FieldEditor({
  pdfUrl,
  pageSizes,
  participants,
  value,
  onChange,
  customFields: providedCustomFields,
  documentName,
  className,
}: FieldEditorProps) {
  const pdf = usePdfDocument(pdfUrl);
  const sizes = pdf.pageSizes.length ? pdf.pageSizes : pageSizes;
  const pageCount = sizes.length;

  const [zoom, setZoom] = useState(1);
  const scale = BASE_SCALE * zoom;

  const [expanded, setExpanded] = useState<string | null>(participants[0]?.key ?? null);
  const expandedKey = participants.some((p) => p.key === expanded) ? expanded : null;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [armed, setArmed] = useState<ArmedTool | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [history, setHistoryState] = useState<History>(EMPTY_HISTORY);
  const [currentPage, setCurrentPage] = useState(1);
  const [docOpen, setDocOpen] = useState(true);

  /*
   * Latest value / history, updated synchronously on every change. Several handlers can run in
   * the same event (e.g. a radio inside a clickable row, key repeat) before React re-renders;
   * reading the props/state of the last render there would push duplicate undo steps.
   */
  const valueRef = useRef(value);
  const historyRef = useRef<History>(EMPTY_HISTORY);
  useLayoutEffect(() => {
    valueRef.current = value;
  });
  const setHistory = (h: History) => {
    historyRef.current = h;
    setHistoryState(h);
  };

  const scrollRef = useRef<HTMLDivElement>(null);
  const clipboard = useRef<EditorField | null>(null);
  const lastCoalesce = useRef<{ key: string; t: number } | null>(null);
  const toolDrag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const pendingScroll = useRef<{ rx: number; ry: number } | null>(null);

  const custom = useCustomFields(providedCustomFields);

  const colorOf = useMemo(() => {
    const m = new Map(participants.map((p) => [p.key, participantColor(p.colorIndex)]));
    return (key: string) => m.get(key) ?? UNKNOWN_COLOR;
  }, [participants]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const f of value) c[f.participantKey] = (c[f.participantKey] ?? 0) + 1;
    return c;
  }, [value]);

  const shown = drag?.moved ? value.map((f) => (f.id === drag.id ? drag.current : f)) : value;
  const selected = shown.find((f) => f.id === selectedId) ?? null;

  const ghostField = useMemo<EditorField | null>(
    () =>
      armed ? { id: "ghost", participantKey: armed.participantKey, page: 0, x: 0, y: 0, ...toolTemplate(armed.tool) } : null,
    [armed],
  );

  /* ------------------------------------------------------------ history */

  const commit = (next: EditorField[], coalesceKey?: string) => {
    const prev = valueRef.current;
    if (next === prev) return;
    const now = Date.now();
    const last = lastCoalesce.current;
    const merge = !!coalesceKey && last?.key === coalesceKey && now - last.t < 1200;
    lastCoalesce.current = coalesceKey ? { key: coalesceKey, t: now } : null;
    const h = historyRef.current;
    setHistory(merge ? (h.future.length ? { ...h, future: [] } : h) : { past: [...h.past, prev].slice(-HISTORY_LIMIT), future: [] });
    valueRef.current = next;
    onChange(next);
  };

  const undo = () => {
    const h = historyRef.current;
    if (!h.past.length) return;
    const prev = h.past[h.past.length - 1];
    lastCoalesce.current = null;
    setHistory({ past: h.past.slice(0, -1), future: [valueRef.current, ...h.future].slice(0, HISTORY_LIMIT) });
    valueRef.current = prev;
    onChange(prev);
  };

  const redo = () => {
    const h = historyRef.current;
    if (!h.future.length) return;
    const [next, ...rest] = h.future;
    lastCoalesce.current = null;
    setHistory({ past: [...h.past, valueRef.current].slice(-HISTORY_LIMIT), future: rest });
    valueRef.current = next;
    onChange(next);
  };

  /* ------------------------------------------------------------- fields */

  const patchField = (id: string, patch: Partial<Omit<EditorField, "id" | "options">>, coalesceKey?: string) => {
    const cur = valueRef.current;
    const f = cur.find((x) => x.id === id);
    if (!f || samePatch(f, patch)) return;
    commit(
      cur.map((x) => (x.id === id ? { ...x, ...patch } : x)),
      coalesceKey,
    );
  };

  const patchOptions = (id: string, patch: Partial<FieldOptions>, coalesceKey?: string) => {
    const cur = valueRef.current;
    const f = cur.find((x) => x.id === id);
    if (!f || samePatch(f.options, patch)) return;
    commit(
      cur.map((x) => (x.id === id ? { ...x, options: { ...x.options, ...patch } } : x)),
      coalesceKey,
    );
  };

  const removeField = (id: string) => {
    const cur = valueRef.current;
    if (!cur.some((f) => f.id === id)) return;
    commit(cur.filter((f) => f.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  const pasteField = () => {
    const src = clipboard.current;
    if (!src || !pageCount) return;
    const page = Math.min(src.page, pageCount);
    const copy = clampToPage(
      { ...src, id: newFieldId(), page, x: src.x + 10, y: src.y + 10, options: structuredClone(src.options) },
      sizes[page - 1],
    );
    commit([...valueRef.current, copy]);
    clipboard.current = copy;
    setSelectedId(copy.id);
  };

  /* ----------------------------------------------------------- geometry */

  const pageElements = () =>
    Array.from(scrollRef.current?.querySelectorAll<HTMLElement>("[data-editor-page]") ?? []).map((el) => ({
      page: Number(el.dataset.editorPage),
      rect: el.getBoundingClientRect(),
    }));

  const pageAt = (cx: number, cy: number) =>
    pageElements().find(({ rect }) => cx >= rect.left && cx <= rect.right && cy >= rect.top && cy <= rect.bottom) ?? null;

  const placeAt = (tool: ArmedTool, page: number, x: number, y: number) => {
    const f = createFieldFromTool(tool.tool, tool.participantKey, page, x, y, sizes[page - 1]);
    commit([...valueRef.current, f]);
    setSelectedId(f.id);
    setArmed(null);
    setPointer(null);
  };

  const scrollToPage = (page: number) => {
    const el = scrollRef.current;
    const target = el?.querySelector<HTMLElement>(`[data-editor-page="${page}"]`);
    if (!el || !target) return;
    const top = el.scrollTop + target.getBoundingClientRect().top - el.getBoundingClientRect().top - 24;
    el.scrollTo({ top, behavior: "smooth" });
    setCurrentPage(page);
  };

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const line = r.top + r.height * 0.35;
    let cur = 1;
    for (const p of pageElements()) if (p.rect.top <= line) cur = p.page;
    if (cur !== currentPage) setCurrentPage(cur);
  };

  /* --------------------------------------------------------------- zoom */

  const zoomTo = (z: number) => {
    const next = clamp(z, ZOOM_STEPS[0], ZOOM_STEPS[ZOOM_STEPS.length - 1]);
    if (next === zoom) return;
    const el = scrollRef.current;
    if (el) {
      pendingScroll.current = {
        rx: (el.scrollLeft + el.clientWidth / 2) / Math.max(1, el.scrollWidth),
        ry: (el.scrollTop + el.clientHeight / 2) / Math.max(1, el.scrollHeight),
      };
    }
    setZoom(next);
  };
  const zoomIn = () => zoomTo(ZOOM_STEPS.find((s) => s > zoom + 0.001) ?? zoom);
  const zoomOut = () => zoomTo([...ZOOM_STEPS].reverse().find((s) => s < zoom - 0.001) ?? zoom);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    const p = pendingScroll.current;
    if (!el || !p) return;
    pendingScroll.current = null;
    el.scrollTop = p.ry * el.scrollHeight - el.clientHeight / 2;
    el.scrollLeft = p.rx * el.scrollWidth - el.clientWidth / 2;
  }, [zoom]);

  /* -------------------------------------------------------------- tools */

  const activateTool: ToolActivate = (tool, participantKey, e, opts) => {
    const same =
      armed &&
      armed.participantKey === participantKey &&
      JSON.stringify(armed.tool) === JSON.stringify(tool);
    if (same && !opts?.force) {
      setArmed(null);
      setPointer(null);
      toolDrag.current = null;
      return;
    }
    setArmed({ tool, participantKey });
    setSelectedId(null);
    toolDrag.current = e ? { x: e.clientX, y: e.clientY, moved: false } : null;
  };

  const onArmedPointerMove = useEffectEvent((e: PointerEvent) => {
    const el = scrollRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    setPointer(inside ? { x: e.clientX, y: e.clientY } : null);
    const td = toolDrag.current;
    if (td && !td.moved && Math.hypot(e.clientX - td.x, e.clientY - td.y) > 6) td.moved = true;
  });

  const onArmedPointerUp = useEffectEvent((e: PointerEvent) => {
    const td = toolDrag.current;
    toolDrag.current = null;
    if (!td?.moved || !armed) return;
    // dragged from a tool button and released over a page → drop there
    const hit = pageAt(e.clientX, e.clientY);
    if (!hit) return;
    suppressClick.current = true;
    window.setTimeout(() => (suppressClick.current = false), 0);
    placeAt(armed, hit.page, (e.clientX - hit.rect.left) / scale, (e.clientY - hit.rect.top) / scale);
  });

  useEffect(() => {
    if (!armed) return;
    const move = (e: PointerEvent) => onArmedPointerMove(e);
    const up = (e: PointerEvent) => onArmedPointerUp(e);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [armed]);

  const onPageClick = (page: number, e: ReactMouseEvent<HTMLDivElement>) => {
    if (suppressClick.current) return;
    if (armed) {
      const rect = e.currentTarget.getBoundingClientRect();
      placeAt(armed, page, (e.clientX - rect.left) / scale, (e.clientY - rect.top) / scale);
      return;
    }
    setSelectedId(null);
  };

  /* --------------------------------------------------------- move/resize */

  const blurActive = () => {
    const a = document.activeElement;
    if (a instanceof HTMLElement && isTypingTarget(a)) a.blur();
  };

  const onFieldPointerDown = (f: EditorField, e: ReactPointerEvent<HTMLDivElement>) => {
    if (armed || e.button !== 0) return; // armed: the page click places a new field
    e.stopPropagation();
    e.preventDefault();
    blurActive();
    setSelectedId(f.id);
    const rect = e.currentTarget.getBoundingClientRect();
    setDrag({
      mode: "move",
      id: f.id,
      startX: e.clientX,
      startY: e.clientY,
      grabX: (e.clientX - rect.left) / scale,
      grabY: (e.clientY - rect.top) / scale,
      orig: f,
      current: f,
      moved: false,
    });
  };

  const onResizePointerDown = (f: EditorField, e: ReactPointerEvent<HTMLSpanElement>) => {
    if (armed || e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    blurActive();
    setSelectedId(f.id);
    setDrag({ mode: "resize", id: f.id, startX: e.clientX, startY: e.clientY, grabX: 0, grabY: 0, orig: f, current: f, moved: false });
  };

  const onDragMove = useEffectEvent((e: PointerEvent) => {
    const d = drag;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
    let next: EditorField;
    if (d.mode === "move") {
      const hit =
        pageAt(e.clientX, e.clientY) ?? pageElements().find((p) => p.page === d.current.page) ?? null;
      if (!hit) return;
      next = clampToPage(
        {
          ...d.current,
          page: hit.page,
          x: (e.clientX - hit.rect.left) / scale - d.grabX,
          y: (e.clientY - hit.rect.top) / scale - d.grabY,
        },
        sizes[hit.page - 1],
      );
    } else {
      const size = sizes[d.orig.page - 1];
      if (!size) return;
      const min = minSize(d.orig.type);
      const maxW = size.w - d.orig.x;
      const maxH = size.h - d.orig.y;
      let w = clamp(d.orig.width + dx / scale, min.w, maxW);
      let h = clamp(d.orig.height + dy / scale, min.h, maxH);
      if (d.orig.type === "checkbox") w = h = Math.min(Math.max(w, h), maxW, maxH);
      next = { ...d.current, width: round2(w), height: round2(h) };
    }
    setDrag({ ...d, moved: true, current: next });
  });

  const onDragEnd = useEffectEvent(() => {
    const d = drag;
    setDrag(null);
    if (!d?.moved) return;
    suppressClick.current = true;
    window.setTimeout(() => (suppressClick.current = false), 0);
    commit(valueRef.current.map((f) => (f.id === d.id ? d.current : f)));
  });

  const dragging = drag !== null;
  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) => onDragMove(e);
    const up = () => onDragEnd();
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [dragging]);

  /* ----------------------------------------------------------- keyboard */

  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
    if (e.defaultPrevented || isTypingTarget(e.target)) return;
    // another dialog (미리보기 등) is open on top of the editor
    if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();

    if (e.key === "Escape") {
      if (armed) {
        setArmed(null);
        setPointer(null);
        toolDrag.current = null;
      } else if (selectedId) setSelectedId(null);
      return;
    }
    if (mod && key === "z") {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if (mod && key === "y") {
      e.preventDefault();
      redo();
      return;
    }
    if (mod && key === "c") {
      if (!selected || (window.getSelection()?.toString() ?? "") !== "") return;
      e.preventDefault();
      clipboard.current = selected;
      return;
    }
    if (mod && key === "v") {
      if (!clipboard.current) return;
      e.preventDefault();
      pasteField();
      return;
    }
    if (!selected) return;
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      removeField(selected.id);
      return;
    }
    const step = e.shiftKey ? 10 : 1;
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const d = delta[e.key];
    if (d) {
      e.preventDefault();
      const moved = clampToPage({ ...selected, x: selected.x + d[0], y: selected.y + d[1] }, sizes[selected.page - 1]);
      patchField(selected.id, { x: moved.x, y: moved.y }, `nudge:${selected.id}`);
    }
  });

  useEffect(() => {
    const h = (e: KeyboardEvent) => onKeyDown(e);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  /* ------------------------------------------------------------- render */

  const ghostColor = armed ? colorOf(armed.participantKey) : UNKNOWN_COLOR;

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col bg-body-2", dragging && "cursor-grabbing select-none", className)}>
      {/* toolbar */}
      <div className="flex h-12 shrink-0 items-center justify-center border-b border-line bg-menu">
        <ToolbarButton label="실행 취소 (Ctrl+Z)" disabled={!history.past.length} onClick={undo}>
          <Undo2 />
        </ToolbarButton>
        <ToolbarButton label="다시 실행 (Ctrl+Shift+Z)" disabled={!history.future.length} onClick={redo}>
          <Redo2 />
        </ToolbarButton>
        <span aria-hidden className="mx-0.5 h-6 w-px bg-line" />
        <ToolbarButton label={`축소 (${Math.round(zoom * 100)}%)`} disabled={zoom <= ZOOM_STEPS[0]} onClick={zoomOut}>
          <CircleMinus />
        </ToolbarButton>
        <ToolbarButton label={`확대 (${Math.round(zoom * 100)}%)`} disabled={zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1]} onClick={zoomIn}>
          <CirclePlus />
        </ToolbarButton>
      </div>

      <div className="flex min-h-0 flex-1">
        <ToolPanel
          participants={participants}
          counts={counts}
          expandedKey={expandedKey}
          onToggle={(key) => setExpanded((cur) => (cur === key ? null : key))}
          armed={armed}
          onActivate={activateTool}
          customFields={custom.customFields}
          customFieldsHref={custom.href}
          onNeedCustomFields={custom.request}
        />

        {/* pages */}
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="relative min-w-0 flex-1 overflow-auto bg-body-2"
          role="region"
          aria-label="문서 페이지"
        >
          {pdf.error ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-fg-muted">
              <TriangleAlert className="size-6 text-negative" />
              <p className="font-medium text-fg-2">문서를 불러오지 못했습니다.</p>
              <p className="text-xs">새로고침 후 다시 시도해 주세요.</p>
            </div>
          ) : !pageCount ? (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-fg-muted">
              <LoaderCircle className="size-5 animate-spin" /> 문서를 불러오는 중…
            </div>
          ) : (
            <div className="flex min-w-max flex-col items-center gap-6 px-10 py-[30px]">
              {sizes.map((size, i) => {
                const page = i + 1;
                const w = size.w * scale;
                const h = size.h * scale;
                return (
                  <div key={page} data-editor-page={page} className="relative shrink-0" style={{ width: w, height: h }}>
                    <PdfPageView
                      doc={pdf.doc}
                      pageNumber={page}
                      width={w}
                      className="!h-full"
                      onClick={(e) => onPageClick(page, e)}
                    >
                      {shown
                        .filter((f) => f.page === page)
                        .map((f) => (
                          <EditorFieldBox
                            key={f.id}
                            field={f}
                            color={colorOf(f.participantKey)}
                            scale={scale}
                            selected={f.id === selectedId}
                            dragging={drag?.id === f.id && drag.moved}
                            onPointerDown={(e) => onFieldPointerDown(f, e)}
                            onResizePointerDown={(e) => onResizePointerDown(f, e)}
                            onClick={(e) => {
                              if (!armed) e.stopPropagation();
                            }}
                            onFocus={() => {
                              if (!armed && !drag) setSelectedId(f.id);
                            }}
                          />
                        ))}
                    </PdfPageView>
                    {pdf.loading && i === 0 && (
                      <div className="pointer-events-none absolute inset-x-0 top-6 flex justify-center">
                        <span className="flex items-center gap-1.5 rounded-full bg-menu px-3 py-1 text-xs text-fg-2 shadow-menu">
                          <LoaderCircle className="size-3.5 animate-spin" /> 불러오는 중…
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* right panel */}
        <aside aria-label={selected ? "입력란 속성" : "문서"} className="flex w-[240px] shrink-0 flex-col border-l border-line bg-surface">
          {selected ? (
            <PropertiesPanel
              key={selected.id}
              field={selected}
              participants={participants}
              onPatch={(patch, ck) => patchField(selected.id, patch, ck)}
              onOptions={(patch, ck) => patchOptions(selected.id, patch, ck)}
              onDelete={() => removeField(selected.id)}
            />
          ) : (
            <>
              <div className="flex h-[55px] shrink-0 items-center gap-1 border-b border-line-light pl-4 pr-2">
                <h2 className="flex-1 text-sm font-bold text-fg">문서</h2>
                <button
                  type="button"
                  aria-label="문서 순서 변경"
                  title="문서 순서 변경"
                  onClick={() => toast("문서가 1개뿐이라 순서를 변경할 수 없습니다.")}
                  className="flex size-8 items-center justify-center rounded text-icon-2 hover:bg-btn-light"
                >
                  <ArrowRightLeft className="size-[18px]" />
                </button>
                <button
                  type="button"
                  aria-label="문서 추가"
                  title="문서 추가"
                  onClick={() => toast("준비 중인 기능입니다.")}
                  className="flex size-8 items-center justify-center rounded text-icon-2 hover:bg-btn-light"
                >
                  <Plus className="size-[18px]" />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto pb-6">
                <button
                  type="button"
                  aria-expanded={docOpen}
                  onClick={() => setDocOpen((o) => !o)}
                  className="flex h-12 w-full items-center gap-2 px-4 text-left hover:bg-surface-3"
                >
                  <span className="min-w-0 flex-1 truncate text-sm font-bold text-fg">{documentName || "문서"}</span>
                  {docOpen ? <ChevronUp className="size-4 text-icon-2" /> : <ChevronDown className="size-4 text-icon-2" />}
                </button>
                {docOpen && (
                  <>
                    <p className="-mt-1 mb-2 text-center text-xs text-fg-2">{pageCount} 페이지</p>
                    <div className="flex flex-col items-center gap-3">
                      {sizes.map((size, i) => {
                        const page = i + 1;
                        const active = page === currentPage;
                        return (
                          <button
                            key={page}
                            type="button"
                            onClick={() => scrollToPage(page)}
                            aria-label={`${page} 페이지로 이동`}
                            aria-current={active ? "page" : undefined}
                            className="flex flex-col items-center gap-1"
                          >
                            <span
                              className={cn(
                                "block rounded border-2 p-[2px] transition-colors",
                                active ? "border-emphasis" : "border-transparent hover:border-line-strong",
                              )}
                            >
                              <span className="relative block" style={{ width: 116, height: (116 * size.h) / size.w }}>
                                <PdfPageView doc={pdf.doc} pageNumber={page} width={116} className="!h-full shadow-none" />
                                {shown.some((f) => f.page === page) && (
                                  <span className="pointer-events-none absolute inset-0">
                                    {shown
                                      .filter((f) => f.page === page)
                                      .map((f) => (
                                        <span
                                          key={f.id}
                                          className="absolute"
                                          style={{
                                            left: (f.x * 116) / size.w,
                                            top: (f.y * 116) / size.w,
                                            width: Math.max(2, (f.width * 116) / size.w),
                                            height: Math.max(2, (f.height * 116) / size.w),
                                            background: colorOf(f.participantKey),
                                            opacity: 0.6,
                                          }}
                                        />
                                      ))}
                                  </span>
                                )}
                              </span>
                            </span>
                            <span className={cn("text-xs", active ? "font-bold text-fg" : "text-fg-2")}>{page}</span>
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </aside>
      </div>

      {armed && pointer && ghostField && (
        <EditorFieldBox
          ghost
          field={ghostField}
          color={ghostColor}
          scale={scale}
          style={{ position: "fixed", left: pointer.x, top: pointer.y, zIndex: 60 }}
        />
      )}
    </div>
  );
}
