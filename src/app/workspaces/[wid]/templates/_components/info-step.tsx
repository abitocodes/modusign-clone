"use client";

import { FileText, ListOrdered, Tag, Users } from "lucide-react";
import type { ReactNode } from "react";

import { LabelChips } from "@/components/templates/parts";
import { Checkbox } from "@/components/ui/controls";
import { FilledField } from "@/components/ui/input";
import { TEMPLATE_TITLE_MAX, whoLabel, type RoleDraft } from "@/lib/templates/model";
import type { Label, RequestType, SigningOrder } from "@/lib/types";
import { participantColor } from "@/lib/utils";

function Row({ icon, title, desc, control, children }: { icon: ReactNode; title: string; desc?: ReactNode; control?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex items-start gap-4 border-b border-line-light p-6 last:border-b-0">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-4 text-icon-2 [&_svg]:size-[18px]">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-bold text-fg">{title}</p>
        {desc && <p className="mt-0.5 text-[13px] text-fg-muted">{desc}</p>}
        {children}
      </div>
      {control && <div className="shrink-0 self-center">{control}</div>}
    </div>
  );
}

const smallBtn = "h-[30px] rounded border border-line-strong bg-btn-light px-2.5 text-[13px] font-semibold text-fg-2 transition-colors hover:bg-btn-base";

/** Step D — 템플릿 정보 (title, labels, sharing) + a summary of what is saved. */
export function InfoStep({
  mode,
  title,
  onTitle,
  labels,
  labelIds,
  onOpenLabels,
  shared,
  canShare,
  onShared,
  documentName,
  pageCount,
  requestType,
  signingOrder,
  roles,
  fieldCounts,
}: {
  mode: "new" | "edit";
  title: string;
  onTitle: (v: string) => void;
  labels: Label[];
  labelIds: string[];
  onOpenLabels: () => void;
  shared: boolean;
  canShare: boolean;
  onShared: (v: boolean) => void;
  documentName: string;
  pageCount: number;
  requestType: RequestType;
  signingOrder: SigningOrder;
  roles: RoleDraft[];
  fieldCounts: Record<string, number>;
}) {
  const who = whoLabel(requestType);
  return (
    <main className="mx-auto w-full max-w-[732px] flex-1 px-4 pb-24 pt-10">
      <p className="text-[13px] font-medium text-fg-muted">{mode === "new" ? "템플릿 등록" : "템플릿 수정"} · 4/4단계</p>
      <h1 className="mt-1 text-[22px] font-bold text-fg">템플릿 정보</h1>

      <p className="mb-2 mt-6 text-[13px] font-medium text-fg-muted">기본 정보</p>
      <div className="rounded-xl border border-line-strong bg-surface">
        <div className="border-b border-line-light px-6 pb-4 pt-6">
          <FilledField label="템플릿 제목" value={title} onChange={onTitle} maxLength={TEMPLATE_TITLE_MAX} />
          {!title.trim() && <p className="-mt-4 text-xs text-negative">템플릿 제목을 입력해 주세요.</p>}
        </div>
        <Row
          icon={<Tag />}
          title="라벨"
          desc="이 템플릿으로 만든 문서에 자동으로 붙일 라벨을 지정합니다."
          control={
            <button type="button" onClick={onOpenLabels} className={smallBtn}>
              설정
            </button>
          }
        >
          {labelIds.length > 0 && (
            <div className="mt-2.5">
              <LabelChips ids={labelIds} labels={labels} max={10} empty={null} />
            </div>
          )}
        </Row>
        <Row
          icon={<Users />}
          title="멤버에게 공유"
          desc={canShare ? "워크스페이스의 모든 멤버가 이 템플릿을 보고 사용할 수 있습니다." : "템플릿을 등록한 멤버나 관리자만 공유 설정을 바꿀 수 있습니다."}
          control={<Checkbox checked={shared} disabled={!canShare} onChange={onShared} aria-label="멤버에게 공유" />}
        />
      </div>

      <p className="mb-2 mt-6 text-[13px] font-medium text-fg-muted">구성</p>
      <div className="rounded-xl border border-line-strong bg-surface">
        <Row icon={<FileText />} title="문서" desc={`${documentName} · ${pageCount}페이지`} />
        <Row
          icon={<ListOrdered />}
          title={`${who} 역할 ${roles.length}개`}
          desc={`${requestType === "view" ? "열람" : "서명"} 요청 · ${signingOrder === "sequential" ? "순서대로 진행" : "순서 없이 동시에 진행"}`}
        >
          <ul className="mt-3 space-y-1.5">
            {roles.map((r, i) => (
              <li key={r.key} className="flex items-center gap-2 text-[13px] text-fg-2">
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: participantColor(i) }} aria-hidden />
                {signingOrder === "sequential" && <span className="w-4 text-fg-muted">{i + 1}</span>}
                <span className="min-w-0 truncate font-medium text-fg">{r.name}</span>
                <span className="text-fg-muted">· 입력란 {fieldCounts[r.key] ?? 0}개</span>
              </li>
            ))}
          </ul>
        </Row>
      </div>
    </main>
  );
}
