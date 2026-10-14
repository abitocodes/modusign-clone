import { Send } from "lucide-react";
import Link from "next/link";

import { getWorkspaceContext } from "@/lib/data/session";
import { createClient } from "@/lib/supabase/server";
import type { DocumentRow, Participant, Profile } from "@/lib/types";
import { docMatchesFilter, type DocFilter } from "@/lib/utils";

import { HomeFooter, LearnCard, NewsCard, ProgressCard, type HomeStat } from "./home-cards";
import { resolvePeriod, type ResolvedPeriod } from "./period";

export const metadata = { title: "홈 | OpenSign" };

const STATS: { filter: DocFilter; label: string; dotClass: string }[] = [
  { filter: "need_signing", label: "내 서명 필요", dotClass: "bg-warning-strong" },
  { filter: "wait_for_signing", label: "상대 서명 필요", dotClass: "bg-radio-on" },
  { filter: "signing_completed", label: "서명 완료", dotClass: "bg-positive" },
  { filter: "scheduled", label: "예약 중", dotClass: "bg-fg-strong" },
];

type DocLite = Pick<DocumentRow, "id" | "owner_id" | "status" | "request_type" | "created_at" | "requested_at"> & {
  participants: Pick<Participant, "email" | "status">[] | null;
};

const PAGE = 1000;
const MAX_PAGES = 20;

/**
 * 진행 현황 counts for the current user in this workspace: documents the user requested or
 * participates in, whose request date (or creation date before sending) lies in the period.
 * Classification uses the same rules as the 문서함 filters (`docMatchesFilter`).
 */
async function loadProgress(wid: string, me: Profile, period: ResolvedPeriod): Promise<Record<string, number> | null> {
  const supabase = await createClient();
  const fromIso = period.from.toISOString();
  const docs: DocLite[] = [];
  for (let i = 0; i < MAX_PAGES; i++) {
    const { data, error } = await supabase
      .from("documents")
      .select("id, owner_id, status, request_type, created_at, requested_at, participants(email, status)")
      .eq("workspace_id", wid)
      .eq("hidden", false)
      .or(`created_at.gte."${fromIso}",requested_at.gte."${fromIso}"`)
      .order("created_at", { ascending: false })
      .range(i * PAGE, i * PAGE + PAGE - 1);
    if (error) return null;
    docs.push(...((data ?? []) as unknown as DocLite[]));
    if (!data || data.length < PAGE) break;
  }

  const myEmail = me.email.toLowerCase();
  const from = period.from.getTime();
  const to = period.to?.getTime() ?? Number.POSITIVE_INFINITY;
  const counts: Record<string, number> = Object.fromEntries(STATS.map((s) => [s.filter, 0]));
  for (const d of docs) {
    const parts = d.participants ?? [];
    const mine = d.owner_id === me.id || parts.some((p) => (p.email ?? "").toLowerCase() === myEmail);
    if (!mine) continue;
    const at = new Date(d.requested_at ?? d.created_at).getTime();
    if (at < from || at >= to) continue;
    for (const s of STATS) if (docMatchesFilter(s.filter, d, parts, myEmail)) counts[s.filter] += 1;
  }
  return counts;
}

async function loadHome(wid: string, sp: Record<string, string | string[] | undefined>) {
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const { profile } = await getWorkspaceContext(wid);
  const period = resolvePeriod({ period: first(sp.period), from: first(sp.from), to: first(sp.to) }, new Date());
  const counts = await loadProgress(wid, profile, period);
  return { profile, period, counts };
}

export default async function HomePage({ params, searchParams }: PageProps<"/workspaces/[wid]/esign/home">) {
  const { wid } = await params;
  const { profile, period, counts } = await loadHome(wid, await searchParams);
  const base = `/workspaces/${wid}`;

  const stats: HomeStat[] = STATS.map((s) => ({
    key: s.filter,
    label: s.label,
    dotClass: s.dotClass,
    count: counts?.[s.filter] ?? 0,
    href: `${base}/esign/documents/documents?status=${s.filter}`,
  }));

  return (
    <main className="min-w-0 flex-1 bg-body-2 px-4">
      <div className="mx-auto w-full max-w-[744px] pt-[34px]">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="truncate text-base font-medium text-fg">{profile.name} 님,</p>
            <p className="mt-0.5 text-lg text-fg">오늘 서명 요청할 문서가 있나요?</p>
          </div>
          <Link
            href={`${base}/esign/requests/request`}
            className="flex h-[42px] shrink-0 items-center gap-2 rounded-md bg-primary px-5 text-base font-medium text-primary-fg shadow-button hover:bg-primary-hover"
          >
            <Send className="size-[18px] -rotate-12" fill="currentColor" />
            서명 요청 시작하기
          </Link>
        </div>

        <ProgressCard
          stats={stats}
          error={counts == null}
          period={{ key: period.key, label: period.label, fromDay: period.fromDay, toDay: period.toDay }}
        />
        <LearnCard base={base} />
        <NewsCard />
        <HomeFooter />
      </div>
    </main>
  );
}
