/** Original line illustration for empty lists: a document tray with a magnifier. */
export function EmptyDocumentsIllustration({ className }: { className?: string }) {
  return (
    <svg width="120" height="96" viewBox="0 0 120 96" fill="none" className={className} aria-hidden>
      <rect x="22" y="10" width="56" height="70" rx="6" className="fill-surface-4 stroke-line-strong" strokeWidth="2" />
      <rect x="32" y="24" width="30" height="4" rx="2" className="fill-line-strong" />
      <rect x="32" y="34" width="36" height="4" rx="2" className="fill-line" />
      <rect x="32" y="44" width="24" height="4" rx="2" className="fill-line" />
      <path d="M10 62h22l6 10h24l6-10h22v20a6 6 0 0 1-6 6H16a6 6 0 0 1-6-6V62z" className="fill-surface-3 stroke-line-strong" strokeWidth="2" />
      <circle cx="88" cy="38" r="13" className="fill-surface stroke-emphasis" strokeWidth="3" />
      <path d="M97.5 47.5 108 58" className="stroke-emphasis" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}
