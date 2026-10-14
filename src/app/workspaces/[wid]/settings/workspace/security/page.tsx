import { Check, KeyRound, LogIn, Monitor, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";

import { PASSWORD_MIN } from "@/components/settings/shared";
import { CardTitle, Divider, InfoRow, SettingsCard } from "@/components/settings/ui";
import { StatusBadge } from "@/components/ui/badge";
import { getWorkspaceContext } from "@/lib/data/session";
import { requestMeta } from "@/lib/events";
import { createClient } from "@/lib/supabase/server";
import { fmtDateTime } from "@/lib/utils";

function describeAgent(ua: string) {
  if (!ua) return "-";
  const browser = /Edg\//.test(ua)
    ? "Microsoft Edge"
    : /Whale\//.test(ua)
      ? "Naver Whale"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Firefox\//.test(ua)
          ? "Firefox"
          : /Safari\//.test(ua)
            ? "Safari"
            : "알 수 없는 브라우저";
  const os = /Windows/.test(ua)
    ? "Windows"
    : /Android/.test(ua)
      ? "Android"
      : /iPhone|iPad/.test(ua)
        ? "iOS"
        : /Mac OS X/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : "기타 OS";
  return `${browser} · ${os}`;
}

function Section({ icon, title, badge, children }: { icon: ReactNode; title: string; badge?: ReactNode; children: ReactNode }) {
  return (
    <section className="py-6 first:pt-0 last:pb-0">
      <div className="flex items-center gap-2">
        <span className="text-fg-muted [&_svg]:size-[18px]">{icon}</span>
        <h3 className="text-base font-bold text-fg">{title}</h3>
        {badge}
      </div>
      <div className="mt-3 pl-[26px] text-[13px] leading-relaxed text-fg-2">{children}</div>
    </section>
  );
}

function Bullet({ children }: { children: ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <Check className="mt-[3px] size-3.5 shrink-0 text-positive" strokeWidth={3} />
      <span>{children}</span>
    </li>
  );
}

export default async function SecurityPage({ params }: PageProps<"/workspaces/[wid]/settings/workspace/security">) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(wid);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { ip, userAgent } = await requestMeta();

  return (
    <>
      <SettingsCard>
        <CardTitle title="인증 및 접근 제어" description="사내 전용 서비스의 로그인 방식과 계정 보안 정책입니다." />
        <div className="mt-6 divide-y divide-line-light">
          <Section icon={<LogIn />} title="로그인 방식" badge={<StatusBadge tone="positive">사용 중</StatusBadge>}>
            <p>
              관리자가 발급한 <b className="text-fg">아이디(또는 이메일)와 비밀번호</b>로만 로그인할 수 있습니다. 직원 계정은 통합 설정 &gt; 멤버에서
              최고 관리자 또는 관리자가 만듭니다.
            </p>
            <ul className="mt-2.5 space-y-1">
              <Bullet>외부 회원가입, 소셜 로그인, 휴대폰 본인 인증은 제공하지 않습니다.</Bullet>
              <Bullet>외부 서명자는 로그인하지 않고, 이메일로 받은 서명 링크에서 이메일 주소를 확인한 뒤 서명합니다.</Bullet>
            </ul>
          </Section>
          <Section icon={<KeyRound />} title="비밀번호 정책">
            <ul className="space-y-1">
              <Bullet>{PASSWORD_MIN}자 이상, 영문과 숫자를 모두 포함해야 하며 공백은 사용할 수 없습니다.</Bullet>
              <Bullet>초기 비밀번호는 관리자가 발급합니다. 첫 로그인 후 개인 설정 &gt; 비밀번호 변경에서 바꿔 주세요.</Bullet>
              <Bullet>비밀번호를 잊어버린 경우 관리자에게 비밀번호 초기화를 요청해 주세요.</Bullet>
              <Bullet>비밀번호는 암호화되어 저장되며, 관리자도 기존 비밀번호를 확인할 수 없습니다.</Bullet>
            </ul>
          </Section>
          <Section icon={<ShieldCheck />} title="세션">
            <ul className="space-y-1">
              <Bullet>로그인 세션은 브라우저 쿠키에 저장되며, 인증 토큰은 1시간마다 자동으로 갱신됩니다.</Bullet>
              <Bullet>로그아웃하면 이 브라우저의 세션이 즉시 종료됩니다.</Bullet>
              <Bullet>공용 PC에서는 사용 후 반드시 로그아웃해 주세요.</Bullet>
            </ul>
          </Section>
        </div>
      </SettingsCard>

      <SettingsCard>
        <CardTitle
          title={
            <span className="flex items-center gap-2">
              <Monitor className="size-5 text-fg-muted" />
              현재 접속 정보
            </span>
          }
        />
        <dl className="mt-5 space-y-0.5">
          <InfoRow label="계정">
            <span className="font-medium">{ctx.profile.name}</span>
            <span className="text-[13px] text-fg-faint">({ctx.profile.email})</span>
          </InfoRow>
          <InfoRow label="마지막 로그인">{fmtDateTime(user?.last_sign_in_at)}</InfoRow>
          <InfoRow label="접속 IP">{ip}</InfoRow>
          <InfoRow label="브라우저">{describeAgent(userAgent)}</InfoRow>
        </dl>
        <Divider className="mt-5" />
        <p className="mt-4 text-xs text-fg-muted">접속 정보가 본인의 것이 아니라면 즉시 비밀번호를 변경하고 관리자에게 알려 주세요.</p>
      </SettingsCard>
    </>
  );
}
