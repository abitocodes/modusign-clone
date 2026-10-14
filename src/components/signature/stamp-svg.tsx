import type { StampSpec } from "./stamp";

/** Inline SVG preview of a generated stamp (uses the page's web fonts). */
export function StampSvg({ spec, size = 80, className }: { spec: StampSpec; size?: number; className?: string }) {
  return (
    <svg
      viewBox={`0 0 ${spec.size} ${spec.size}`}
      width={size}
      height={size}
      className={className}
      aria-hidden
      focusable="false"
    >
      {spec.prims.map((p, i) => {
        if (p.t === "ellipse")
          return <ellipse key={i} cx={p.cx} cy={p.cy} rx={p.rx} ry={p.ry} fill="none" stroke={spec.color} strokeWidth={p.sw} />;
        if (p.t === "rect")
          return (
            <rect key={i} x={p.x} y={p.y} width={p.w} height={p.h} rx={p.r} fill="none" stroke={spec.color} strokeWidth={p.sw} />
          );
        return (
          <text
            key={i}
            x={0}
            y={0}
            transform={`matrix(${p.m.join(" ")})`}
            fill={spec.color}
            fontFamily={p.font.family}
            fontWeight={p.font.weight}
            fontSize={p.size}
          >
            {p.ch}
          </text>
        );
      })}
    </svg>
  );
}
