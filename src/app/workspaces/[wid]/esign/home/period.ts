/**
 * 홈 > 진행 현황 period (?period=30d|60d|90d|180d|year|custom&from=YYYY-MM-DD&to=YYYY-MM-DD).
 * Shared by the server page (filtering) and the client period select (labels).
 */

export type PeriodKey = "30d" | "60d" | "90d" | "180d" | "year" | "custom";

export const PERIOD_OPTIONS: { value: PeriodKey; label: string }[] = [
  { value: "30d", label: "최근 30일" },
  { value: "60d", label: "최근 60일" },
  { value: "90d", label: "최근 90일" },
  { value: "180d", label: "최근 180일" },
  { value: "year", label: "올해" },
  { value: "custom", label: "직접 입력" },
];

export const DEFAULT_PERIOD: PeriodKey = "30d";

export interface ResolvedPeriod {
  key: PeriodKey;
  /** inclusive start */
  from: Date;
  /** exclusive end (null = now / open) */
  to: Date | null;
  /** YYYY-MM-DD values for the custom range inputs */
  fromDay: string;
  toDay: string;
  label: string;
}

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const pad = (n: number) => String(n).padStart(2, "0");
const toDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function parseDay(v: string | undefined): Date | null {
  const m = v ? DAY_RE.exec(v) : null;
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]) ? d : null;
}

/** YY.MM.DD */
export function shortDay(day: string) {
  const m = DAY_RE.exec(day);
  return m ? `${m[1].slice(2)}.${m[2]}.${m[3]}` : day;
}

export function resolvePeriod(sp: { period?: string; from?: string; to?: string }, now: Date): ResolvedPeriod {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const key = (PERIOD_OPTIONS.some((o) => o.value === sp.period) ? sp.period : DEFAULT_PERIOD) as PeriodKey;

  if (key === "custom") {
    const f = parseDay(sp.from);
    const t = parseDay(sp.to);
    if (f && t && f <= t) {
      const end = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1);
      return { key, from: f, to: end, fromDay: toDay(f), toDay: toDay(t), label: `${shortDay(toDay(f))} ~ ${shortDay(toDay(t))}` };
    }
    return resolvePeriod({ period: DEFAULT_PERIOD }, now);
  }

  const days = { "30d": 30, "60d": 60, "90d": 90, "180d": 180 } as const;
  const from = key === "year" ? new Date(today.getFullYear(), 0, 1) : new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days[key] - 1));
  return {
    key,
    from,
    to: null,
    fromDay: toDay(from),
    toDay: toDay(today),
    label: PERIOD_OPTIONS.find((o) => o.value === key)!.label,
  };
}
