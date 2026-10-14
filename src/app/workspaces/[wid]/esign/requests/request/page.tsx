import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { getWorkspaceContext } from "@/lib/data/session";

import { BulkSendArt, LinkSignArt, SingleRequestArt } from "./illustrations";

export const metadata = { title: "요청 방식 | OpenSign" };

function MethodRow({
  href,
  art,
  title,
  description,
  hoverAction,
}: {
  href: string;
  art: ReactNode;
  title: string;
  description: string;
  hoverAction?: string;
}) {
  return (
    <Link
      href={href}
      className="group flex min-h-[121px] items-center gap-6 rounded-xl border border-line p-3 transition-colors hover:bg-surface-3 focus-visible:bg-surface-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emphasis"
    >
      <span className="block h-[95px] w-[146px] shrink-0 overflow-hidden rounded-lg">{art}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-lg font-bold text-fg">{title}</span>
        <span className="mt-1 block text-sm text-fg-2">{description}</span>
      </span>
      {hoverAction && (
        <span
          aria-hidden
          className="mr-3 hidden h-[34px] shrink-0 items-center gap-1 rounded bg-btn-dark px-3 text-sm font-medium text-fg-2 group-hover:flex group-focus-visible:flex"
        >
          {hoverAction}
          <ChevronRight className="size-4" />
        </span>
      )}
    </Link>
  );
}

function MethodCard({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section aria-label={title} className={className}>
      <div className="rounded-xl border border-line-light bg-surface p-6">
        <h2 className="mb-4 text-lg font-medium text-fg">{title}</h2>
        <div className="flex flex-col gap-[18px]">{children}</div>
      </div>
    </section>
  );
}

export default async function RequestMethodPage({ params }: PageProps<"/workspaces/[wid]/esign/requests/request">) {
  const { wid } = await params;
  const { profile } = await getWorkspaceContext(wid);
  const base = `/workspaces/${wid}`;

  return (
    <div className="min-h-[calc(100vh-56px)] bg-body-2 px-4 pb-16">
      <div className="mx-auto w-full max-w-[744px] pt-[34px]">
        <p className="truncate text-base font-medium text-fg">{profile.name}님,</p>
        <h1 className="mt-0.5 text-lg font-normal text-fg">어떤 방식으로 서명을 요청할까요?</h1>

        <MethodCard title="기본" className="mt-6">
          <MethodRow
            href={`${base}/documents/d/upload`}
            art={<SingleRequestArt />}
            title="단건 요청"
            description="한 문서에 서명자를 1명 또는 여러 명으로 지정해서 요청해요."
            hoverAction="파일 업로드"
          />
        </MethodCard>

        <MethodCard title="고급" className="mt-[18px]">
          <MethodRow
            href={`${base}/esign/requests/bulk-requests`}
            art={<BulkSendArt />}
            title="대량전송"
            description="동일 양식의 문서를 지정된 다수에게 일괄 요청해요."
          />
          <MethodRow
            href={`${base}/esign/requests/links`}
            art={<LinkSignArt />}
            title="링크서명"
            description="서명자를 미리 지정하지 않고, 링크로 서명을 받아요."
          />
        </MethodCard>
      </div>
    </div>
  );
}
