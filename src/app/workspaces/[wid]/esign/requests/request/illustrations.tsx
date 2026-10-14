/**
 * Original 146×95 illustrations for the 요청 방식 cards (cream background).
 * Illustration colours are artwork colours and intentionally theme independent.
 */

const CREAM = "#fff6e1";
const YELLOW = "#ffc627";
const AMBER = "#f2a516";
const INK = "#3b3530";

export function SingleRequestArt() {
  return (
    <svg width="146" height="95" viewBox="0 0 146 95" aria-hidden className="block">
      <rect width="146" height="95" fill={CREAM} />
      {/* signed sheet */}
      <rect x="30" y="26" width="38" height="40" rx="4" fill={INK} />
      <path d="M38 52c3-9 6-13 8-11s-4 10-1 10 6-12 8-10-2 7 1 7 4-3 5-4" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M37 58h24" stroke="#fff" strokeOpacity=".45" strokeWidth="1.5" strokeLinecap="round" />
      <rect x="20" y="62" width="14" height="9" rx="2" fill={INK} opacity=".75" />
      {/* cursor */}
      <path d="m44 58 9 3-4 1.5L47.5 67z" fill="#fff" stroke={INK} strokeWidth="1.4" strokeLinejoin="round" />
      {/* stamp */}
      <rect x="76" y="17" width="34" height="34" rx="6" fill={YELLOW} />
      <rect x="80" y="21" width="26" height="26" rx="4" fill="none" stroke="#fff" strokeWidth="1.6" strokeOpacity=".9" />
      <text x="93" y="39.5" textAnchor="middle" fontSize="15" fontWeight="800" fill="#fff" fontFamily="Pretendard, sans-serif">
        인
      </text>
      <path d="m103 46 8 3-3.5 1.4L106 55z" fill="#fff" stroke={INK} strokeWidth="1.4" strokeLinejoin="round" />
      <rect x="112" y="55" width="14" height="9" rx="2" fill={AMBER} />
    </svg>
  );
}

export function BulkSendArt() {
  return (
    <svg width="146" height="95" viewBox="0 0 146 95" aria-hidden className="block">
      <rect width="146" height="95" fill={CREAM} />
      <path d="M14 78c14-8 26-10 40-11" stroke={AMBER} strokeOpacity=".35" strokeWidth="6" strokeLinecap="round" fill="none" />
      {/* big plane */}
      <path d="m18 66 52-26-18 34-8-10z" fill={YELLOW} />
      <path d="m44 64 26-24-24 27z" fill={AMBER} />
      <path d="m44 64 1 11 7-1z" fill={AMBER} opacity=".8" />
      {/* medium plane */}
      <path d="m78 46 40-20-14 27-6-8z" fill={YELLOW} />
      <path d="m98 45 20-19-18 21z" fill={AMBER} />
      {/* small plane */}
      <path d="m70 22 24-11-8 15-4-4z" fill={YELLOW} />
      <path d="m82 22 12-11-11 12z" fill={AMBER} />
      <path d="M58 30c4-2 7-3 10-4M104 62c5-2 9-5 12-8" stroke={AMBER} strokeOpacity=".45" strokeWidth="2" strokeLinecap="round" strokeDasharray="2 4" fill="none" />
    </svg>
  );
}

export function LinkSignArt() {
  return (
    <svg width="146" height="95" viewBox="0 0 146 95" aria-hidden className="block">
      <rect width="146" height="95" fill={CREAM} />
      {/* laptop */}
      <rect x="30" y="14" width="86" height="56" rx="4" fill={INK} />
      <rect x="34" y="18" width="78" height="48" rx="2" fill={YELLOW} />
      <path d="M16 72h114l-6 7H22z" fill="#57514b" />
      <rect x="62" y="72" width="22" height="2.5" rx="1.2" fill="#8a837c" />
      {/* link badge */}
      <rect x="58" y="27" width="30" height="30" rx="7" fill={AMBER} stroke="#fff" strokeOpacity=".55" strokeWidth="1.5" />
      <g transform="rotate(-45 73 42)" fill="none" stroke="#fff" strokeWidth="2.6">
        <rect x="58.5" y="37" width="17" height="10" rx="5" />
        <rect x="70.5" y="37" width="17" height="10" rx="5" />
      </g>
    </svg>
  );
}
