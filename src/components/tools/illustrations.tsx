/** Original inline illustrations of the 도구 / 결재 area. */

/** Document with an upload arrow (내부결재 > 업로드로 기안 작성). */
export function UploadDocIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 160 120" className={className} aria-hidden>
      <ellipse cx="80" cy="108" rx="54" ry="6" fill="currentColor" opacity="0.08" />
      <rect x="44" y="14" width="64" height="84" rx="6" fill="var(--btn-light)" stroke="var(--line-strong)" strokeWidth="2" />
      <path d="M90 14v14a4 4 0 0 0 4 4h14" fill="var(--menu)" stroke="var(--line-strong)" strokeWidth="2" strokeLinejoin="round" />
      <rect x="54" y="42" width="34" height="5" rx="2.5" fill="var(--line-strong)" />
      <rect x="54" y="54" width="44" height="5" rx="2.5" fill="var(--line)" />
      <rect x="54" y="66" width="28" height="5" rx="2.5" fill="var(--line)" />
      <rect x="30" y="66" width="38" height="20" rx="4" fill="var(--negative)" />
      <text x="49" y="80" textAnchor="middle" fontSize="11" fontWeight="800" fill="#fff" fontFamily="sans-serif">
        PDF
      </text>
      <circle cx="112" cy="80" r="17" fill="var(--primary)" />
      <path d="M112 89V72m0 0-6.5 6.5M112 72l6.5 6.5" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

/** Two stacked approval boxes with a check (빈 결재 화면). */
export function ApprovalBoxesIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 80" className={className} aria-hidden>
      <rect x="10" y="12" width="44" height="56" rx="4" fill="var(--surface-4)" stroke="var(--line-strong)" strokeWidth="2" />
      <rect x="66" y="12" width="44" height="56" rx="4" fill="var(--surface-4)" stroke="var(--line-strong)" strokeWidth="2" />
      <path d="M10 26h44M66 26h44" stroke="var(--line-strong)" strokeWidth="2" />
      <circle cx="32" cy="46" r="12" fill="none" stroke="var(--negative)" strokeWidth="2.5" />
      <path d="M26.5 46l4 4 7.5-8" stroke="var(--negative)" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="78" y="42" width="20" height="8" rx="4" fill="var(--line)" />
    </svg>
  );
}
