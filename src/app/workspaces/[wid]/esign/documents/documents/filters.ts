/**
 * URL state of the 문서함 list (shared by the server page and the client view).
 * Defaults are omitted from the query string.
 */
import { isIsoDay } from "@/lib/documents/view";
import { DOC_FILTER_LABELS, type DocFilter } from "@/lib/utils";

export type SearchScope = "title" | "requester" | "signer";
export type DateType = "activity" | "requested" | "completed";
export type ShareFilter = "all" | "mine" | "received";
export type HiddenFilter = "exclude" | "only" | "include";
export type SortKey = "title" | "requested" | "completed" | "activity";
export type SortDir = "asc" | "desc";

export interface DocListFilters {
  status: DocFilter;
  mine: boolean;
  /** documents I requested or take part in (홈 > 진행 현황 cards) */
  involved: boolean;
  scope: SearchScope;
  q: string;
  dt: DateType;
  from: string | null;
  to: string | null;
  label: string;
  share: ShareFilter;
  hidden: HiddenFilter;
  sort: SortKey;
  dir: SortDir;
  page: number;
  size: number;
}

export const DEFAULT_FILTERS: DocListFilters = {
  status: "all",
  mine: false,
  involved: false,
  scope: "title",
  q: "",
  dt: "activity",
  from: null,
  to: null,
  label: "",
  share: "all",
  hidden: "exclude",
  sort: "activity",
  dir: "desc",
  page: 1,
  size: 10,
};

export const SCOPE_OPTIONS: { value: SearchScope; label: string; placeholder: string }[] = [
  { value: "title", label: "제목", placeholder: "문서 제목으로 찾기" },
  { value: "requester", label: "요청자", placeholder: "요청자 이름, 이메일로 찾기" },
  { value: "signer", label: "서명자", placeholder: "서명자 이름, 이메일로 찾기" },
];
export const DATE_TYPE_OPTIONS: { value: DateType; label: string }[] = [
  { value: "activity", label: "마지막 활동일" },
  { value: "requested", label: "요청일" },
  { value: "completed", label: "체결일" },
];
export const SHARE_OPTIONS: { value: ShareFilter; label: string }[] = [
  { value: "all", label: "모든 공유 문서" },
  { value: "mine", label: "내가 공유한 문서" },
  { value: "received", label: "공유받은 문서" },
];
export const HIDDEN_OPTIONS: { value: HiddenFilter; label: string }[] = [
  { value: "exclude", label: "숨긴 문서 제외" },
  { value: "only", label: "숨긴 문서만" },
  { value: "include", label: "숨긴 문서 포함" },
];
export const PAGE_SIZE_VALUES = [10, 20, 35, 50, 100];

/** column of `documents` behind each sort key / date type */
export const SORT_COLUMN: Record<SortKey, string> = {
  title: "title",
  requested: "requested_at",
  completed: "completed_at",
  activity: "last_activity_at",
};
export const DATE_COLUMN: Record<DateType, string> = {
  activity: "last_activity_at",
  requested: "requested_at",
  completed: "completed_at",
};

type RawSearch = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
function pick<T extends string>(v: string, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

export function parseDocListFilters(sp: RawSearch): DocListFilters {
  const d = DEFAULT_FILTERS;
  const status = one(sp.status);
  const page = Number.parseInt(one(sp.page), 10);
  const size = Number.parseInt(one(sp.size), 10);
  const from = one(sp.from);
  const to = one(sp.to);
  const label = one(sp.label);
  return {
    status: Object.hasOwn(DOC_FILTER_LABELS, status) ? (status as DocFilter) : d.status,
    mine: one(sp.mine) === "1",
    involved: one(sp.involved) === "1",
    scope: pick(one(sp.scope), ["title", "requester", "signer"], d.scope),
    q: one(sp.q).trim().slice(0, 100),
    dt: pick(one(sp.dt), ["activity", "requested", "completed"], d.dt),
    from: isIsoDay(from) ? from : null,
    to: isIsoDay(to) ? to : null,
    label: /^[0-9a-f-]{36}$/i.test(label) ? label : "",
    share: pick(one(sp.share), ["all", "mine", "received"], d.share),
    hidden: pick(one(sp.hidden), ["exclude", "only", "include"], d.hidden),
    sort: pick(one(sp.sort), ["title", "requested", "completed", "activity"], d.sort),
    dir: pick(one(sp.dir), ["asc", "desc"], d.dir),
    page: Number.isFinite(page) && page > 0 ? page : 1,
    size: PAGE_SIZE_VALUES.includes(size) ? size : d.size,
  };
}

export function filtersToQuery(f: DocListFilters) {
  const qs = new URLSearchParams();
  qs.set("status", f.status);
  if (f.mine) qs.set("mine", "1");
  if (f.involved) qs.set("involved", "1");
  if (f.q) {
    qs.set("q", f.q);
    if (f.scope !== "title") qs.set("scope", f.scope);
  } else if (f.scope !== DEFAULT_FILTERS.scope) qs.set("scope", f.scope);
  if (f.dt !== DEFAULT_FILTERS.dt) qs.set("dt", f.dt);
  if (f.from) qs.set("from", f.from);
  if (f.to) qs.set("to", f.to);
  if (f.label) qs.set("label", f.label);
  if (f.share !== DEFAULT_FILTERS.share) qs.set("share", f.share);
  if (f.hidden !== DEFAULT_FILTERS.hidden) qs.set("hidden", f.hidden);
  if (f.sort !== DEFAULT_FILTERS.sort || f.dir !== DEFAULT_FILTERS.dir) {
    qs.set("sort", f.sort);
    qs.set("dir", f.dir);
  }
  if (f.size !== DEFAULT_FILTERS.size) qs.set("size", String(f.size));
  if (f.page > 1) qs.set("page", String(f.page));
  return qs.toString();
}

/** true when any filter other than the sidebar status / sort / paging is active */
export function hasActiveFilters(f: DocListFilters) {
  return !!(f.mine || f.involved || f.q || f.from || f.to || f.label || f.share !== "all" || f.hidden !== "exclude");
}
