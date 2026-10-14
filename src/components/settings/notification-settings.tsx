"use client";

import { Bell, Mail } from "lucide-react";
import { type ReactNode, useMemo, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { useWorkspace } from "@/components/shell/workspace-context";
import { Switch } from "@/components/ui/controls";

import { CardTitle, Divider, SettingsCard } from "./ui";

type PrefKey =
  | "signRequest"
  | "completed"
  | "rejected"
  | "cancelled"
  | "expiring"
  | "reminder"
  | "webNeedSign"
  | "webShared";

type Prefs = Record<PrefKey, boolean>;

const DEFAULTS: Prefs = {
  signRequest: true,
  completed: true,
  rejected: true,
  cancelled: true,
  expiring: false,
  reminder: true,
  webNeedSign: true,
  webShared: false,
};

const SECTIONS: { title: string; icon: ReactNode; items: { key: PrefKey; label: string; description: string }[] }[] = [
  {
    title: "이메일 알림",
    icon: <Mail />,
    items: [
      { key: "signRequest", label: "서명 요청을 받았을 때", description: "다른 멤버나 외부에서 나에게 서명을 요청하면 이메일로 알려 드립니다." },
      { key: "completed", label: "서명이 완료되었을 때", description: "내가 요청한 문서의 모든 서명이 끝나면 완료 문서와 함께 알려 드립니다." },
      { key: "rejected", label: "서명이 거절되었을 때", description: "참여자가 서명을 거절하면 거절 사유와 함께 알려 드립니다." },
      { key: "cancelled", label: "서명 요청이 취소되었을 때", description: "내가 참여한 문서의 서명 요청이 취소되면 알려 드립니다." },
      { key: "expiring", label: "서명 기한 만료 전", description: "서명 기한이 하루 남은 문서가 있으면 알려 드립니다." },
      { key: "reminder", label: "리마인드 알림", description: "요청자가 서명 알림을 다시 보내면 이메일로 받습니다." },
    ],
  },
  {
    title: "웹 알림",
    icon: <Bell />,
    items: [
      { key: "webNeedSign", label: "내 서명이 필요한 문서", description: "홈 화면과 문서함에서 내 서명이 필요한 문서를 강조해 보여 드립니다." },
      { key: "webShared", label: "문서를 공유받았을 때", description: "다른 멤버가 문서를 자동 공유하면 화면 알림으로 알려 드립니다." },
    ],
  },
];

const EVENT = "opensign:notification-prefs";

function storageKey(userId: string) {
  return `opensign:notification-prefs:${userId}`;
}

function readRaw(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(EVENT, onChange);
  };
}

function parse(raw: string | null): Prefs {
  if (!raw) return DEFAULTS;
  try {
    const v = JSON.parse(raw) as Partial<Record<PrefKey, unknown>>;
    const out = { ...DEFAULTS };
    for (const k of Object.keys(DEFAULTS) as PrefKey[]) if (typeof v[k] === "boolean") out[k] = v[k] as boolean;
    return out;
  } catch {
    return DEFAULTS;
  }
}

/** 개인 설정 > 알림 — preferences are kept in this browser (localStorage). */
export function NotificationSettings() {
  const { profile } = useWorkspace();
  const key = storageKey(profile.id);
  const raw = useSyncExternalStore(
    subscribe,
    () => readRaw(key),
    () => null,
  );
  const prefs = useMemo(() => parse(raw), [raw]);

  const update = (k: PrefKey, value: boolean) => {
    const next = { ...prefs, [k]: value };
    try {
      window.localStorage.setItem(key, JSON.stringify(next));
      window.dispatchEvent(new Event(EVENT));
      toast.success(value ? "알림을 켰습니다." : "알림을 껐습니다.");
    } catch {
      toast.error("이 브라우저에서는 알림 설정을 저장할 수 없습니다.");
    }
  };

  return (
    <SettingsCard>
      <CardTitle title="알림" description="받고 싶은 알림을 선택해 주세요. 알림 설정은 현재 사용 중인 브라우저에 저장됩니다." />
      {SECTIONS.map((s, si) => (
        <section key={s.title} className="mt-7">
          {si > 0 && <Divider className="mb-7" />}
          <h3 className="flex items-center gap-2 text-base font-bold text-fg">
            <span className="text-fg-muted [&_svg]:size-[18px]">{s.icon}</span>
            {s.title}
          </h3>
          <ul className="mt-3 divide-y divide-line-light rounded-lg border border-line-light">
            {s.items.map((it) => (
              <li key={it.key}>
                {/* the label gives the switch button its accessible name */}
                <label className="flex cursor-pointer items-center justify-between gap-6 px-5 py-4 hover:bg-surface-3">
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-fg">{it.label}</span>
                    <span className="mt-0.5 block text-[13px] text-fg-muted">{it.description}</span>
                  </span>
                  <Switch checked={prefs[it.key]} onChange={(v) => update(it.key, v)} />
                </label>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </SettingsCard>
  );
}
