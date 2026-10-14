/**
 * Date formatting of the signer pages. Always Korea time, so the server render and the browser
 * hydration produce the same text whatever the machine's time zone is.
 */
const parts = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: Intl.DateTimeFormatPartTypes) => f.find((p) => p.type === t)?.value ?? "";
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour") === "24" ? "00" : get("hour"), min: get("minute") };
};

/** 2026-10-14 13:35 */
export function fmtSeoulDateTime(iso: string | null | undefined) {
  if (!iso) return "-";
  const p = parts(iso);
  return p ? `${p.y}-${p.m}-${p.d} ${p.h}:${p.min}` : "-";
}

/** 2026년 10월 28일 오후 12시 51분 */
export function fmtSeoulKorean(iso: string | null | undefined) {
  if (!iso) return "-";
  const p = parts(iso);
  if (!p) return "-";
  const h = Number(p.h);
  return `${p.y}년 ${Number(p.m)}월 ${Number(p.d)}일 ${h < 12 ? "오전" : "오후"} ${h % 12 === 0 ? 12 : h % 12}시 ${p.min}분`;
}
