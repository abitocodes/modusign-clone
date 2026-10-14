import { FileSignature, Link2Off, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import { LinkSignForm } from "./link-form";
import { loadLink } from "./load";

export const metadata: Metadata = { title: "링크서명 | OpenSign", robots: { index: false, follow: false } };

function Shell({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-body-2">
      <header className="flex h-[62px] shrink-0 items-center border-b border-line bg-surface px-5">
        <span className="text-[15px] font-bold tracking-tight text-fg">
          OpenSign
        </span>
      </header>
      <main className="flex flex-1 flex-col items-center px-4 pb-16 pt-12 sm:pt-[72px]">
        {children}
        {footer}
      </main>
    </div>
  );
}

function Card({ children }: { children: ReactNode }) {
  return <section className="flex w-full max-w-[414px] flex-col items-center rounded-xl border border-line bg-surface px-6 py-14 text-center sm:px-[47px]">{children}</section>;
}

function IconCircle({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "warning" }) {
  return (
    <span className={tone === "warning" ? "flex size-[62px] items-center justify-center rounded-full bg-warning-bg text-warning" : "flex size-[62px] items-center justify-center rounded-full bg-line text-fg-3"}>
      {children}
    </span>
  );
}

function Message({ icon, title, lines, tone }: { icon: ReactNode; title: string; lines: string[]; tone?: "warning" }) {
  return (
    <Shell>
      <Card>
        <IconCircle tone={tone}>{icon}</IconCircle>
        <h1 className="mt-5 text-xl font-bold text-fg">{title}</h1>
        {lines.map((l) => (
          <p key={l} className="mt-2 text-[13px] font-medium leading-relaxed text-fg-2">
            {l}
          </p>
        ))}
      </Card>
    </Shell>
  );
}

/** /link/[token] — public 링크서명 entry: the visitor enters name + e-mail, then signs at /sign/[token]. */
export default async function LinkSignPage({ params }: PageProps<"/link/[token]">) {
  const { token } = await params;
  const state = await loadLink(token);

  if (state.kind === "missing") {
    return <Message icon={<Link2Off className="size-7" />} title="존재하지 않는 링크입니다" lines={["링크 주소가 올바른지 확인해 주세요."]} />;
  }
  if (state.kind === "inactive") {
    return (
      <Message
        icon={<Link2Off className="size-7" />}
        title="현재 서명을 받지 않는 링크입니다"
        lines={[`'${state.title}' 링크서명이 비활성화되었습니다.`, "링크를 전달한 담당자에게 문의해 주세요."]}
      />
    );
  }
  if (state.kind === "unavailable") {
    return (
      <Message
        tone="warning"
        icon={<TriangleAlert className="size-7" />}
        title="서명할 문서를 준비할 수 없습니다"
        lines={["링크에 연결된 템플릿이 삭제되었거나 변경되었습니다.", "링크를 전달한 담당자에게 문의해 주세요."]}
      />
    );
  }

  const verb = state.template.request_type === "view" ? "열람" : "서명";
  return (
    <Shell
      footer={
        <p className="mt-4 max-w-[414px] text-center text-xs leading-relaxed text-fg-faint">
          {state.workspaceName ? `${state.workspaceName}의 ` : ""}
          {state.ownerName} 님이 만든 링크서명입니다. 문서를 열고 {verb}한 기록(시간, IP)은 감사 추적 인증서에 남습니다.
        </p>
      }
    >
      <Card>
        <IconCircle>
          <FileSignature className="size-7" strokeWidth={1.8} />
        </IconCircle>
        <h1 className="mt-5 text-xl font-bold text-fg">{verb}자 정보 입력</h1>
        <p className="mt-2 text-[13px] font-medium leading-relaxed text-fg-2">
          &lsquo;{state.link.title}&rsquo; 문서에 {verb}하려면
          <br />
          이름과 이메일 주소를 입력하세요.
        </p>
        <LinkSignForm token={token} title={state.link.title} verb={verb} />
      </Card>
    </Shell>
  );
}
