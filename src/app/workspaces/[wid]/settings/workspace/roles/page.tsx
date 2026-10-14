import { Check, Minus } from "lucide-react";

import { ROLE_DESCRIPTION, ROLE_LABEL } from "@/components/settings/shared";
import { CardTitle, RoleBadge, SettingsCard } from "@/components/settings/ui";
import { getWorkspaceContext } from "@/lib/data/session";
import type { MemberRole } from "@/lib/types";
import { cn } from "@/lib/utils";

import { loadMembers } from "../../_lib/server";

type Grant = boolean | string;

const PERMISSIONS: { group: string; rows: { label: string; owner: Grant; admin: Grant; member: Grant }[] }[] = [
  {
    group: "워크스페이스",
    rows: [
      { label: "워크스페이스 이름 변경", owner: true, admin: true, member: false },
      { label: "최고 관리자 변경", owner: true, admin: false, member: false },
      { label: "워크스페이스 삭제", owner: true, admin: false, member: false },
      { label: "감사 로그 조회", owner: true, admin: true, member: false },
    ],
  },
  {
    group: "멤버·그룹",
    rows: [
      { label: "멤버 목록 조회", owner: true, admin: true, member: true },
      { label: "멤버 추가·삭제", owner: true, admin: true, member: false },
      { label: "역할 변경", owner: true, admin: "관리자·멤버만", member: false },
      { label: "비밀번호 초기화·정보 수정", owner: true, admin: true, member: false },
      { label: "그룹 만들기·편집", owner: true, admin: true, member: false },
    ],
  },
  {
    group: "전자서명",
    rows: [
      { label: "서명 요청·문서함 이용", owner: true, admin: true, member: true },
      { label: "템플릿 만들기·편집", owner: true, admin: true, member: true },
      { label: "내 문서 자동 공유 설정", owner: true, admin: true, member: true },
      { label: "모든 문서 자동 공유·멤버별 자동 공유 설정", owner: true, admin: true, member: false },
    ],
  },
];

const ROLES: MemberRole[] = ["owner", "admin", "member"];

function GrantCell({ value }: { value: Grant }) {
  if (value === true) {
    return (
      <span className="inline-flex size-5 items-center justify-center rounded-full bg-positive-bg text-positive" aria-label="가능">
        <Check className="size-3.5" strokeWidth={3} />
      </span>
    );
  }
  if (value === false) {
    return (
      <span className="inline-flex text-fg-disabled" aria-label="불가">
        <Minus className="size-4" />
      </span>
    );
  }
  return <span className="text-xs font-medium text-emphasis">{value}</span>;
}

export default async function RolesPage({ params }: PageProps<"/workspaces/[wid]/settings/workspace/roles">) {
  const { wid } = await params;
  await getWorkspaceContext(wid);
  const members = await loadMembers(wid);
  const count = (r: MemberRole) => members.filter((m) => m.role === r).length;

  return (
    <>
      <SettingsCard>
        <CardTitle title="역할" description="워크스페이스 멤버에게는 아래 세 가지 역할 중 하나가 부여됩니다. 역할은 멤버 메뉴에서 변경할 수 있습니다." />
        <div className="mt-6 grid grid-cols-3 gap-3">
          {ROLES.map((r) => (
            <div key={r} className="rounded-lg border border-line-light bg-surface-2 p-5">
              <div className="flex items-center justify-between">
                <RoleBadge role={r} />
                <span className="text-[13px] text-fg-muted">
                  <b className="font-bold text-fg">{count(r)}</b>명
                </span>
              </div>
              <p className="mt-3 text-base font-bold text-fg">{ROLE_LABEL[r]}</p>
              <p className="mt-1 text-[13px] leading-relaxed text-fg-muted">{ROLE_DESCRIPTION[r]}</p>
            </div>
          ))}
        </div>
      </SettingsCard>

      <SettingsCard>
        <CardTitle title="역할별 권한" />
        <table className="mt-5 w-full border-collapse text-sm">
          <thead>
            <tr className="h-[46px] border-b border-line text-[13px] text-fg-faint">
              <th scope="col" className="text-left font-normal">
                권한
              </th>
              {ROLES.map((r) => (
                <th key={r} scope="col" className="w-[120px] text-center font-normal">
                  {ROLE_LABEL[r]}
                </th>
              ))}
            </tr>
          </thead>
          {PERMISSIONS.map((g) => (
            <tbody key={g.group}>
              <tr>
                <th colSpan={4} scope="colgroup" className="bg-surface-3 px-3 py-2 text-left text-xs font-medium text-fg-muted">
                  {g.group}
                </th>
              </tr>
              {g.rows.map((row, i) => (
                <tr key={row.label} className={cn("h-12 border-b border-line-light", i === g.rows.length - 1 && "border-line")}>
                  <th scope="row" className="px-3 text-left font-normal text-fg-2">
                    {row.label}
                  </th>
                  {ROLES.map((r) => (
                    <td key={r} className="text-center">
                      <GrantCell value={row[r]} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </SettingsCard>
    </>
  );
}
