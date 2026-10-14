import { ExternalLink, Inbox, RefreshCw, Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { StatusBadge } from "@/components/ui/badge";
import { createAdminClient } from "@/lib/supabase/admin";
import type { OutboundEmail } from "@/lib/types";
import { cn, fmtDashDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "개발용 메일함 | OpenSign" };

const MAILPIT_URL = "http://127.0.0.1:54324";
const LIMIT = 100;

const KIND_LABEL: Record<string, string> = {
  sign_request: "서명 요청",
  completed: "서명 완료",
  rejected: "서명 거절",
  cancelled: "요청 취소",
  reminder: "리마인드",
  approval: "결재",
  other: "기타",
};

type ListRow = Pick<OutboundEmail, "id" | "to_email" | "to_name" | "subject" | "kind" | "delivered" | "created_at">;

/** Links in the preview open in a new tab instead of inside the iframe. */
function previewHtml(html: string) {
  const base = '<base target="_blank">';
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => `${m}${base}`) : `${base}${html}`;
}

function href(params: { id?: string | null; q?: string }) {
  const sp = new URLSearchParams();
  if (params.q) sp.set("q", params.q);
  if (params.id) sp.set("id", params.id);
  const s = sp.toString();
  return `/dev/mailbox${s ? `?${s}` : ""}`;
}

/**
 * Development mailbox: every e-mail the app sends is logged in public.outbound_emails
 * (also delivered to the local Mailpit when SMTP is configured). Public route under /dev/.
 */
export default async function DevMailboxPage({ searchParams }: PageProps<"/dev/mailbox">) {
  // contains live signing links — never expose it in production builds unless explicitly enabled
  if (process.env.NODE_ENV === "production" && process.env.ENABLE_DEV_MAILBOX !== "1") notFound();

  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 100) : "";
  const requestedId = typeof sp.id === "string" && /^[0-9a-f-]{36}$/i.test(sp.id) ? sp.id : null;

  const admin = createAdminClient();
  let query = admin
    .from("outbound_emails")
    .select("id, to_email, to_name, subject, kind, delivered, created_at")
    .order("created_at", { ascending: false })
    .limit(LIMIT);
  const term = q.replace(/[,()%*\\"]/g, " ").trim();
  if (term) query = query.or(`to_email.ilike.%${term}%,subject.ilike.%${term}%,to_name.ilike.%${term}%`);
  const { data, error } = await query;
  const mails = (data ?? []) as ListRow[];

  const selectedId = requestedId ?? mails[0]?.id ?? null;
  const { data: selectedRow } = selectedId
    ? await admin.from("outbound_emails").select("*").eq("id", selectedId).maybeSingle()
    : { data: null };
  const selected = selectedRow as OutboundEmail | null;

  return (
    <div className="flex h-screen flex-col bg-body-2 text-fg">
      <header className="flex h-14 shrink-0 items-center gap-4 border-b border-line bg-surface px-6">
        <Inbox className="size-5 text-icon-2" aria-hidden />
        <h1 className="text-base font-bold">개발용 메일함</h1>
        <span className="text-[13px] text-fg-muted">최근 {LIMIT}통 · outbound_emails</span>
        <div className="ml-auto flex items-center gap-3">
          <form action="/dev/mailbox" className="relative">
            <input
              name="q"
              defaultValue={q}
              placeholder="받는 사람, 제목으로 검색"
              aria-label="메일 검색"
              className="h-9 w-64 rounded border border-transparent bg-surface-3 pl-3 pr-9 text-sm text-fg shadow-input outline-none focus:border-emphasis"
            />
            <button type="submit" aria-label="검색" className="absolute inset-y-0 right-1 flex w-8 items-center justify-center text-fg-faint hover:text-fg">
              <Search className="size-4" />
            </button>
          </form>
          <Link
            href={href({ q, id: requestedId })}
            className="flex h-9 items-center gap-1.5 rounded border border-line-strong bg-btn-light px-3 text-[13px] font-semibold text-fg-2 hover:bg-btn-base"
          >
            <RefreshCw className="size-3.5" />
            새로고침
          </Link>
          <a
            href={MAILPIT_URL}
            target="_blank"
            rel="noreferrer"
            className="flex h-9 items-center gap-1.5 rounded bg-btn-dark px-3 text-[13px] font-semibold text-fg-2 hover:bg-btn-hover"
          >
            Mailpit 열기
            <ExternalLink className="size-3.5" />
          </a>
        </div>
      </header>

      <p className="shrink-0 border-b border-line-light bg-warning-bg px-6 py-2 text-xs text-fg-2">
        로컬 개발용 화면입니다. SMTP_HOST가 설정되어 있으면 메일은 로컬 Mailpit(
        <a href={MAILPIT_URL} target="_blank" rel="noreferrer" className="text-emphasis underline">
          {MAILPIT_URL}
        </a>
        )으로도 전달됩니다. 미리보기의 버튼은 새 탭에서 열립니다.
      </p>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[420px] shrink-0 flex-col border-r border-line bg-surface">
          {error ? (
            <p className="p-6 text-sm text-negative">메일 목록을 불러오지 못했습니다: {error.message}</p>
          ) : mails.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
              <Inbox className="size-8 text-fg-disabled" aria-hidden />
              <p className="text-sm text-fg-muted">{q ? "검색 결과가 없습니다." : "아직 발송된 메일이 없습니다."}</p>
            </div>
          ) : (
            <ul className="min-h-0 flex-1 overflow-y-auto" aria-label="메일 목록">
              {mails.map((m) => {
                const active = m.id === selectedId;
                return (
                  <li key={m.id} className="border-b border-line-faint">
                    <Link
                      href={href({ q, id: m.id })}
                      aria-current={active ? "true" : undefined}
                      className={cn("block px-5 py-3.5 transition-colors", active ? "bg-emphasis-bg" : "hover:bg-surface-3")}
                    >
                      <div className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-fg">
                          {m.to_name ? `${m.to_name} <${m.to_email}>` : m.to_email}
                        </span>
                        <span className="shrink-0 text-[11px] text-fg-muted">{fmtDashDateTime(m.created_at)}</span>
                      </div>
                      <p className={cn("mt-1 truncate text-[13px]", active ? "text-emphasis-strong" : "text-fg-2")}>{m.subject}</p>
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <StatusBadge tone="neutral" dot={false}>
                          {KIND_LABEL[m.kind] ?? m.kind}
                        </StatusBadge>
                        <StatusBadge tone={m.delivered ? "positive" : "warning"} dot>
                          {m.delivered ? "SMTP 전달됨" : "기록만 됨"}
                        </StatusBadge>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        <section className="flex min-w-0 flex-1 flex-col" aria-label="메일 미리보기">
          {selected ? (
            <>
              <div className="shrink-0 border-b border-line bg-surface px-6 py-4">
                <h2 className="text-[15px] font-bold text-fg">{selected.subject}</h2>
                <dl className="mt-2 grid grid-cols-[72px_1fr] gap-x-3 gap-y-1 text-[13px]">
                  <dt className="text-fg-muted">받는 사람</dt>
                  <dd className="text-fg-2">{selected.to_name ? `${selected.to_name} <${selected.to_email}>` : selected.to_email}</dd>
                  <dt className="text-fg-muted">보낸 시각</dt>
                  <dd className="text-fg-2">{fmtDashDateTime(selected.created_at)}</dd>
                  <dt className="text-fg-muted">종류</dt>
                  <dd className="text-fg-2">
                    {KIND_LABEL[selected.kind] ?? selected.kind} · {selected.delivered ? "SMTP로 전달됨" : "SMTP 미전달 (DB 기록만)"}
                  </dd>
                </dl>
              </div>
              <div className="min-h-0 flex-1 bg-canvas p-4">
                <iframe
                  title="메일 미리보기"
                  srcDoc={previewHtml(selected.html)}
                  sandbox="allow-popups allow-popups-to-escape-sandbox"
                  className="size-full rounded border border-line bg-page"
                />
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-fg-muted">
              {requestedId ? "메일을 찾을 수 없습니다." : "왼쪽 목록에서 메일을 선택하세요."}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
