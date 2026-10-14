/** Original illustrations for the 홈 > 소식 carousel (theme tokens via CSS variables). */

export function CabinetArt() {
  return (
    <svg width="150" height="72" viewBox="0 0 150 72" aria-hidden>
      <rect x="22" y="14" width="86" height="54" rx="7" fill="var(--surface-4)" stroke="var(--line-strong)" />
      <path d="M22 26a7 7 0 0 1 7-7h22l6 6h44a7 7 0 0 1 7 7v4H22z" fill="var(--warning)" opacity=".9" />
      <rect x="34" y="6" width="44" height="34" rx="3" fill="var(--page)" transform="rotate(-6 56 23)" />
      <rect x="46" y="4" width="44" height="36" rx="3" fill="var(--page)" />
      <path d="M53 14h26M53 20h30M53 26h18" stroke="var(--line)" strokeWidth="2.4" strokeLinecap="round" />
      <rect x="22" y="34" width="86" height="34" rx="7" fill="var(--warning-strong)" />
      <rect x="54" y="45" width="22" height="5" rx="2.5" fill="var(--warning-bg)" opacity=".7" />
      <circle cx="122" cy="46" r="15" fill="var(--positive)" />
      <path d="m115 46 5 5 9-10" fill="none" stroke="var(--page)" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ShieldArt() {
  return (
    <svg width="150" height="72" viewBox="0 0 150 72" aria-hidden>
      <rect x="10" y="22" width="70" height="34" rx="8" fill="var(--surface-4)" stroke="var(--line-strong)" />
      <rect x="18" y="31" width="30" height="5" rx="2.5" fill="var(--text-faint)" />
      <circle cx="22" cy="46" r="3" fill="var(--text-2)" />
      <circle cx="31" cy="46" r="3" fill="var(--text-2)" />
      <circle cx="40" cy="46" r="3" fill="var(--text-2)" />
      <circle cx="49" cy="46" r="3" fill="var(--text-2)" />
      <path d="M108 6 132 14v18c0 16-10 27-24 33-14-6-24-17-24-33V14z" fill="var(--emphasis)" />
      <path d="M108 6 132 14v18c0 16-10 27-24 33z" fill="var(--emphasis-strong)" opacity=".45" />
      <circle cx="108" cy="30" r="6" fill="var(--page)" />
      <rect x="105.5" y="33" width="5" height="11" rx="2.5" fill="var(--page)" />
    </svg>
  );
}

export function TemplateArt() {
  return (
    <svg width="150" height="72" viewBox="0 0 150 72" aria-hidden>
      <rect x="44" y="14" width="42" height="48" rx="4" fill="var(--surface-4)" stroke="var(--line-strong)" transform="rotate(-10 65 38)" />
      <rect x="58" y="12" width="44" height="56" rx="4" fill="var(--line-strong)" />
      <rect x="72" y="6" width="46" height="60" rx="4" fill="var(--page)" />
      <rect x="79" y="14" width="22" height="5" rx="2.5" fill="var(--positive)" />
      <path d="M79 27h31M79 34h31M79 41h20" stroke="var(--line)" strokeWidth="2.4" strokeLinecap="round" />
      <rect x="79" y="48" width="18" height="11" rx="2" fill="none" stroke="var(--warning-strong)" strokeWidth="2" strokeDasharray="3 2" />
      <path d="M128 18 120 36h8l-4 18 14-24h-8l5-12z" fill="var(--warning)" />
    </svg>
  );
}
