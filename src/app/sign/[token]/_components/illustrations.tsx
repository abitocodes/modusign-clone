/** Original inline illustrations of the signer pages. */

/** grey avatar circle with a lighter user silhouette (본인 확인 필요) */
export function AvatarIllustration({ size = 62 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 62 62" aria-hidden className="shrink-0">
      <circle cx="31" cy="31" r="31" className="fill-line" />
      <clipPath id="sign-avatar-clip">
        <circle cx="31" cy="31" r="31" />
      </clipPath>
      <g clipPath="url(#sign-avatar-clip)" className="fill-fg-disabled">
        <circle cx="31" cy="24" r="11" />
        <ellipse cx="31" cy="55" rx="21" ry="15" />
      </g>
    </svg>
  );
}

/** round icon badge used on the status cards */
export function StatusIcon({ tone, children }: { tone: "neutral" | "negative" | "warning" | "positive"; children: React.ReactNode }) {
  const tones = {
    neutral: "bg-line text-fg-3",
    negative: "bg-negative-bg text-negative",
    warning: "bg-warning-bg text-warning",
    positive: "bg-positive-bg text-positive",
  } as const;
  return (
    <span className={`flex size-[62px] shrink-0 items-center justify-center rounded-full ${tones[tone]} [&_svg]:size-7`} aria-hidden>
      {children}
    </span>
  );
}

/** a signed document with a padlock — 서명 내역 card */
export function SecuredDocumentIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 160 132" className={className} aria-hidden>
      <defs>
        <linearGradient id="sign-doc-shade" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.16" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <ellipse cx="80" cy="122" rx="56" ry="7" fill="#000" opacity="0.35" />
      {/* back sheet */}
      <rect x="40" y="22" width="70" height="92" rx="6" fill="#3c3c3c" transform="rotate(-6 75 68)" />
      {/* front sheet */}
      <rect x="46" y="16" width="72" height="96" rx="6" fill="#f0f0f0" />
      <rect x="46" y="16" width="72" height="96" rx="6" fill="url(#sign-doc-shade)" />
      <rect x="56" y="30" width="40" height="5" rx="2.5" fill="#bdbdbd" />
      <rect x="56" y="42" width="52" height="4" rx="2" fill="#d6d6d6" />
      <rect x="56" y="51" width="48" height="4" rx="2" fill="#d6d6d6" />
      <rect x="56" y="60" width="52" height="4" rx="2" fill="#d6d6d6" />
      <rect x="56" y="69" width="30" height="4" rx="2" fill="#d6d6d6" />
      {/* signature stroke */}
      <path d="M58 94c6-10 10-10 11-3s4 7 8-1 7-6 8 0 5 3 9-4" fill="none" stroke="#5991f4" strokeWidth="2.4" strokeLinecap="round" />
      {/* padlock */}
      <path d="M104 64v-8a12 12 0 0 1 24 0v8" fill="none" stroke="#d9d9d9" strokeWidth="5" strokeLinecap="round" />
      <rect x="96" y="62" width="40" height="34" rx="6" fill="#ffcf00" />
      <rect x="96" y="62" width="40" height="10" rx="5" fill="#ffffff" opacity="0.25" />
      <circle cx="116" cy="77" r="4.5" fill="#5c4a00" />
      <rect x="114" y="79" width="4" height="9" rx="2" fill="#5c4a00" />
    </svg>
  );
}
