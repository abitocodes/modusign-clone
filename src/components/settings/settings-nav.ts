export type SettingsTab = "workspace" | "esign" | "cabinet" | "personal";

export interface SettingsNavItem {
  label: string;
  /** path under /workspaces/[wid] */
  href: string;
}

export interface SettingsNavGroup {
  label: string;
  items: SettingsNavItem[];
}

export const SETTINGS_TABS: { key: SettingsTab; label: string; href?: string }[] = [
  { key: "workspace", label: "워크스페이스 관리", href: "/settings/workspace/info" },
  { key: "esign", label: "전자서명 설정", href: "/settings/esign/automatic-sharing" },
  { key: "cabinet", label: "캐비닛 설정" },
  { key: "personal", label: "개인 설정", href: "/settings/personal/member" },
];

export const SETTINGS_NAV: Record<Exclude<SettingsTab, "cabinet">, SettingsNavGroup[]> = {
  workspace: [
    { label: "일반", items: [{ label: "기본 정보", href: "/settings/workspace/info" }] },
    {
      label: "멤버·그룹",
      items: [
        { label: "멤버", href: "/settings/workspace/members" },
        { label: "그룹", href: "/settings/workspace/groups" },
        { label: "역할", href: "/settings/workspace/roles" },
      ],
    },
    {
      label: "인증·보안",
      items: [
        { label: "인증 및 접근 제어", href: "/settings/workspace/security" },
        { label: "감사 로그", href: "/settings/workspace/audit-log" },
      ],
    },
  ],
  esign: [
    {
      label: "문서",
      items: [
        { label: "문서 자동 공유", href: "/settings/esign/automatic-sharing" },
        { label: "문서 수신 제어", href: "/settings/esign/receiving-control" },
        { label: "문서 작업 권한", href: "/settings/esign/document-permissions" },
        { label: "진본증명도장", href: "/settings/esign/certified-stamp" },
      ],
    },
    { label: "브랜딩", items: [{ label: "맞춤 브랜딩", href: "/settings/esign/branding" }] },
  ],
  personal: [
    {
      label: "일반",
      items: [
        { label: "내 멤버 정보", href: "/settings/personal/member" },
        { label: "비밀번호 변경", href: "/settings/personal/password" },
        { label: "알림", href: "/settings/personal/notifications" },
      ],
    },
  ],
};

export function activeSettingsTab(pathname: string): Exclude<SettingsTab, "cabinet"> {
  if (pathname.includes("/settings/esign")) return "esign";
  if (pathname.includes("/settings/personal")) return "personal";
  return "workspace";
}
