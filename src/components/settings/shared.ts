// Shared (client + server) helpers of the 통합 설정 area. No server-only imports here.
import type { BadgeTone } from "@/lib/utils";
import type { MemberRole } from "@/lib/types";

/** Result of every settings Server Action. */
export type ActionResult<T = null> = { ok: true; data: T } | { ok: false; error: string };

export const ROLE_LABEL: Record<MemberRole, string> = { owner: "최고 관리자", admin: "관리자", member: "멤버" };
export const ROLE_DESCRIPTION: Record<MemberRole, string> = {
  owner: "워크스페이스의 모든 설정, 멤버, 역할을 관리할 수 있습니다.",
  admin: "멤버 추가·삭제, 그룹 관리 등 워크스페이스를 함께 관리할 수 있습니다.",
  member: "서명 요청, 문서함 등 전자서명 기능을 이용할 수 있습니다.",
};
export const ROLE_TONE: Record<MemberRole, BadgeTone> = { owner: "warning", admin: "emphasis", member: "neutral" };
export const ROLE_ORDER: Record<MemberRole, number> = { owner: 0, admin: 1, member: 2 };

export const isAdminRole = (role: MemberRole | null | undefined) => role === "owner" || role === "admin";

/** Member row shown in the settings tables (workspace_members + profiles). */
export interface SettingsMember {
  id: string;
  name: string;
  email: string;
  username: string | null;
  department: string | null;
  position: string | null;
  avatar_color: string;
  role: MemberRole;
  joined_at: string;
}

export interface SettingsGroup {
  id: string;
  name: string;
  created_at: string;
  memberIds: string[];
}

/* ---------------------------------------------------------------- validation */

export const USERNAME_RE = /^[a-z0-9._-]{2,30}$/;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const NAME_MAX = 30;
export const ORG_MAX = 30;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 72;

export const PASSWORD_POLICY_TEXT = "8자 이상, 영문과 숫자를 모두 포함해야 합니다.";

/** Returns an error message, or null when the password satisfies the policy. */
export function passwordProblem(pw: string): string | null {
  if (pw.length < PASSWORD_MIN) return `비밀번호는 ${PASSWORD_MIN}자 이상이어야 합니다.`;
  if (pw.length > PASSWORD_MAX) return `비밀번호는 ${PASSWORD_MAX}자 이하로 입력해 주세요.`;
  if (/\s/.test(pw)) return "비밀번호에 공백을 사용할 수 없습니다.";
  if (!/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw)) return "비밀번호는 영문과 숫자를 모두 포함해야 합니다.";
  return null;
}

export function usernameProblem(v: string): string | null {
  if (!v) return "아이디를 입력해 주세요.";
  if (!USERNAME_RE.test(v)) return "아이디는 영문 소문자, 숫자, 마침표(.), 밑줄(_), 하이픈(-)으로 2~30자 입력해 주세요.";
  return null;
}

/** Random initial password: 12 chars, always letters + digits + one symbol. */
export function generatePassword(length = 12): string {
  const lower = "abcdefghijkmnpqrstuvwxyz";
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "23456789";
  const symbols = "!@#$%^&*";
  const all = lower + upper + digits;
  const rand = (n: number) => {
    const buf = new Uint32Array(1);
    globalThis.crypto.getRandomValues(buf);
    return buf[0] % n;
  };
  const chars = [lower[rand(lower.length)], upper[rand(upper.length)], digits[rand(digits.length)], symbols[rand(symbols.length)]];
  while (chars.length < length) chars.push(all[rand(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

/* ------------------------------------------------------------ auto share */

/** workspaces.settings.autoShare — `all`: receives every request, `mine[requesterId]`: receives that member's requests. */
export interface AutoShareSettings {
  all: string[];
  mine: Record<string, string[]>;
}

export const AUTO_SHARE_MAX = 20;

export function readAutoShare(settings: Record<string, unknown> | null | undefined): AutoShareSettings {
  const raw = (settings?.autoShare ?? {}) as { all?: unknown; mine?: unknown };
  const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const mine: Record<string, string[]> = {};
  if (raw.mine && typeof raw.mine === "object" && !Array.isArray(raw.mine)) {
    for (const [k, v] of Object.entries(raw.mine as Record<string, unknown>)) mine[k] = ids(v);
  }
  return { all: ids(raw.all), mine };
}

export function memberMatches(m: SettingsMember, q: string) {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return [m.name, m.email, m.username, m.department, m.position].some((v) => (v ?? "").toLowerCase().includes(s));
}
