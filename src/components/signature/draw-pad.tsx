"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, useState, type PointerEvent as ReactPointerEvent, type Ref } from "react";

import { cn } from "@/lib/utils";

import { drawStroke, drawStrokeSegment, strokesToPng, type Stroke } from "./render";

/** Logical size of the drawing area (CSS px at 100%) */
export const PAD_W = 530;
export const PAD_H = 206;

const MIN_W = 1.7;
const MAX_W = 3.9;

function paint(canvas: HTMLCanvasElement, strokes: Stroke[], scale: number) {
  const g = canvas.getContext("2d");
  if (!g) return;
  g.clearRect(0, 0, canvas.width, canvas.height);
  for (const s of strokes) drawStroke(g, s, scale);
}

export interface DrawPadHandle {
  clear: () => void;
  /** strokes in logical (530×206) coordinates */
  strokes: () => Stroke[];
  /** trimmed transparent PNG (2× resolution) or null when empty */
  toPng: () => string | null;
}

/**
 * Light drawing surface with smooth (quadratic) variable-width black strokes.
 * Pointer events cover mouse, pen (pressure) and touch.
 */
export function DrawPad({
  ref,
  onInkChange,
  placeholder = "네모 위에 사인을 그려주세요",
  className,
}: {
  ref?: Ref<DrawPadHandle>;
  onInkChange?: (hasInk: boolean) => void;
  placeholder?: string;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const activeRef = useRef<{ pointerId: number; stroke: Stroke; x: number; y: number; t: number; w: number } | null>(null);
  const dprRef = useRef(1);
  const [hasInk, setHasInk] = useState(false);

  const onInkRef = useRef(onInkChange);
  useEffect(() => {
    onInkRef.current = onInkChange;
  }, [onInkChange]);

  const ctx = () => canvasRef.current?.getContext("2d") ?? null;

  // backing store at device resolution (re-done when the DPR changes, e.g. browser zoom)
  useEffect(() => {
    let mq: MediaQueryList | null = null;
    const setup = () => {
      const c = canvasRef.current;
      if (!c) return;
      const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
      dprRef.current = dpr;
      c.width = Math.round(PAD_W * dpr);
      c.height = Math.round(PAD_H * dpr);
      paint(c, strokesRef.current, dpr);
      mq?.removeEventListener("change", setup);
      mq = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      mq.addEventListener("change", setup);
    };
    setup();
    return () => mq?.removeEventListener("change", setup);
  }, []);

  const setInk = useCallback((v: boolean) => {
    setHasInk(v);
    onInkRef.current?.(v);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      clear: () => {
        strokesRef.current = [];
        activeRef.current = null;
        if (canvasRef.current) paint(canvasRef.current, [], dprRef.current);
        setInk(false);
      },
      strokes: () => strokesRef.current,
      toPng: () => strokesToPng(strokesRef.current, PAD_W, PAD_H, 2),
    }),
    [setInk],
  );

  const toLocal = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * PAD_W) / r.width, y: ((e.clientY - r.top) * PAD_H) / r.height };
  };

  const widthFor = (velocity: number, pressure: number, pointerType: string) => {
    let w = Math.min(MAX_W, Math.max(MIN_W, MAX_W - velocity * 1.15));
    if (pointerType === "pen" && pressure > 0) w *= 0.55 + pressure * 0.9;
    return w;
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (activeRef.current) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // synthetic / already released pointers cannot be captured — drawing still works
    }
    const p = toLocal(e);
    const w = widthFor(0, e.pressure, e.pointerType) * 0.9;
    const stroke: Stroke = [{ ...p, w }];
    strokesRef.current.push(stroke);
    activeRef.current = { pointerId: e.pointerId, stroke, x: p.x, y: p.y, t: e.timeStamp, w };
    if (!hasInk) setInk(true);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const a = activeRef.current;
    if (!a || a.pointerId !== e.pointerId) return;
    const g = ctx();
    if (!g) return;
    const native = e.nativeEvent;
    const events = typeof native.getCoalescedEvents === "function" ? native.getCoalescedEvents() : [];
    for (const ev of events.length ? events : [native]) {
      const p = toLocal(ev);
      const d = Math.hypot(p.x - a.x, p.y - a.y);
      if (d < 1.2) continue;
      const dt = Math.max(1, ev.timeStamp - a.t);
      const target = widthFor(d / dt, ev.pressure, ev.pointerType);
      const w = a.w * 0.72 + target * 0.28;
      a.stroke.push({ x: p.x, y: p.y, w });
      drawStrokeSegment(g, a.stroke, a.stroke.length - 1, dprRef.current);
      a.x = p.x;
      a.y = p.y;
      a.t = ev.timeStamp;
      a.w = w;
    }
  };

  const endStroke = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const a = activeRef.current;
    if (!a || a.pointerId !== e.pointerId) return;
    const g = ctx();
    if (g) drawStrokeSegment(g, a.stroke, a.stroke.length - 1, dprRef.current, true);
    activeRef.current = null;
  };

  return (
    <div className={cn("relative w-full max-w-[530px]", className)}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="사인 그리기 영역"
        className="block aspect-[530/206] w-full cursor-crosshair touch-none select-none rounded border border-icon-2 bg-canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endStroke}
        onPointerCancel={endStroke}
        onLostPointerCapture={endStroke}
      />
      {!hasInk && (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-base text-neutral-500">
          {placeholder}
        </span>
      )}
    </div>
  );
}
