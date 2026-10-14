"use client";

import { FileText, GripHorizontal, Plus, Trash2 } from "lucide-react";
import { useRef, useState, type DragEvent } from "react";

import { TextField } from "@/components/ui/input";
import { Segmented } from "@/components/ui/tabs";
import { MAX_ROLES, ROLE_NAME_MAX, whoLabel, type RoleDraft } from "@/lib/templates/model";
import type { RequestType, SigningOrder } from "@/lib/types";
import { cn, participantColor } from "@/lib/utils";

const chipClass = "inline-flex h-8 items-center rounded-full border border-line-light bg-surface-4 px-3 text-[15px] font-medium text-fg";

function RoleCard({
  index,
  role,
  who,
  sequential,
  canDelete,
  fieldCount,
  duplicate,
  onRename,
  onDelete,
  onMove,
  setInputEl,
  setCardEl,
  dragging,
  dropTarget,
  onHandleDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: {
  index: number;
  role: RoleDraft;
  who: string;
  sequential: boolean;
  canDelete: boolean;
  fieldCount: number;
  duplicate: boolean;
  onRename: (name: string) => void;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
  setInputEl: (el: HTMLInputElement | null) => void;
  setCardEl: (el: HTMLDivElement | null) => void;
  dragging: boolean;
  dropTarget: boolean;
  onHandleDragStart: (e: DragEvent<HTMLButtonElement>) => void;
  onDragEnd: () => void;
  onDragOver: (e: DragEvent<HTMLDivElement>) => void;
  onDrop: (e: DragEvent<HTMLDivElement>) => void;
}) {
  const label = sequential ? `${who} ${index + 1}` : who;
  const empty = !role.name.trim();
  return (
    <div
      ref={setCardEl}
      onDragOver={onDragOver}
      onDrop={onDrop}
      role="group"
      aria-label={`${label} ${role.name}`.trim()}
      className={cn(
        "relative rounded-xl border border-line-strong bg-surface pb-8 pl-[37px] pr-[18px] pt-[39px] transition-[opacity,border-color]",
        dragging && "opacity-50",
        dropTarget && "border-emphasis",
      )}
    >
      <span className="absolute inset-y-0 left-0 w-1.5 rounded-l-xl" style={{ background: participantColor(index) }} aria-hidden />

      {sequential && (
        <button
          type="button"
          draggable
          onDragStart={onHandleDragStart}
          onDragEnd={onDragEnd}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp") {
              e.preventDefault();
              onMove(-1);
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              onMove(1);
            }
          }}
          aria-label={`${label} 순서 변경 (위·아래 화살표 키)`}
          title="드래그해서 순서 변경"
          className="absolute left-1/2 top-1.5 flex h-5 w-9 -translate-x-1/2 cursor-grab items-center justify-center rounded text-line-strong hover:text-fg-muted active:cursor-grabbing"
        >
          <GripHorizontal className="size-5" />
        </button>
      )}

      <div className="absolute right-[18px] top-[17px] flex items-center gap-3">
        <span className="text-[13px] text-fg-muted">입력란 {fieldCount}개</span>
        {canDelete && (
          <button
            type="button"
            aria-label={`${label} ${role.name.trim()} 삭제`.replace(/\s+/g, " ")}
            title="삭제"
            onClick={onDelete}
            className="flex size-8 items-center justify-center rounded-full border border-line-strong text-icon-2 transition-colors hover:bg-btn-light [&_svg]:size-4"
          >
            <Trash2 />
          </button>
        )}
      </div>

      <div className="flex items-center gap-3">
        <span className={chipClass}>{label}</span>
      </div>

      <div className="mt-[23px] flex items-start gap-[18px] pr-3.5">
        <div className="w-[315px] shrink-0">
          <TextField
            ref={setInputEl}
            label="역할 이름"
            value={role.name}
            maxLength={ROLE_NAME_MAX}
            autoComplete="off"
            invalid={empty || duplicate}
            aria-invalid={empty || duplicate}
            onChange={(e) => onRename(e.target.value)}
          />
          {(empty || duplicate) && <p className="mt-1 pl-1 text-xs text-negative">{empty ? "역할 이름을 입력해 주세요." : "같은 이름의 역할이 있습니다."}</p>}
        </div>
        <p className="self-center text-[13px] leading-relaxed text-fg-muted">
          예) 근로자, 회사 대표, 보호자
          <br />
          템플릿을 사용할 때 이 역할의 이름과 이메일을 입력합니다.
        </p>
      </div>
    </div>
  );
}

/** Step B — 역할 설정 (like the wizard's 참여자 설정, but a role only has a name). */
export function RolesStep({
  mode,
  documentName,
  pageCount,
  onChangeDocument,
  requestType,
  signingOrder,
  roles,
  fieldCounts,
  onRequestType,
  onSigningOrder,
  onRename,
  onAdd,
  onDelete,
  onMove,
}: {
  mode: "new" | "edit";
  documentName: string;
  pageCount: number;
  onChangeDocument: () => void;
  requestType: RequestType;
  signingOrder: SigningOrder;
  roles: RoleDraft[];
  fieldCounts: Record<string, number>;
  onRequestType: (v: RequestType) => void;
  onSigningOrder: (v: SigningOrder) => void;
  onRename: (index: number, name: string) => void;
  /** returns the key of the new role */
  onAdd: () => string | null;
  onDelete: (index: number) => void;
  onMove: (from: number, to: number) => void;
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const inputRefs = useRef(new Map<string, HTMLInputElement>());
  const cardRefs = useRef(new Map<string, HTMLDivElement>());
  const who = whoLabel(requestType);
  const sequential = signingOrder === "sequential";

  const nameCounts = new Map<string, number>();
  for (const r of roles) {
    const k = r.name.trim().toLowerCase();
    if (k) nameCounts.set(k, (nameCounts.get(k) ?? 0) + 1);
  }

  const add = () => {
    const key = onAdd();
    if (!key) return;
    requestAnimationFrame(() => {
      cardRefs.current.get(key)?.scrollIntoView({ behavior: "smooth", block: "center" });
      inputRefs.current.get(key)?.focus({ preventScroll: true });
    });
  };

  return (
    <main className="mx-auto w-full max-w-[872px] flex-1 px-4 pb-24 pt-6">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <p className="text-[13px] font-medium text-fg-muted">{mode === "new" ? "템플릿 등록" : "템플릿 수정"} · 2/4단계</p>
          <h1 className="mt-1 text-[22px] font-bold text-fg">역할 설정</h1>
          <p className="mt-1 text-sm text-fg-muted">템플릿을 사용할 때 참여자 정보를 입력할 역할을 만들고 순서를 정하세요.</p>
        </div>
        <button
          type="button"
          onClick={onChangeDocument}
          className="flex max-w-[300px] shrink-0 items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 text-left text-[13px] text-fg-2 transition-colors hover:bg-surface-3"
          title="문서 변경"
        >
          <FileText className="size-4 shrink-0 text-fg-3" />
          <span className="min-w-0">
            <span className="block truncate font-medium text-fg">{documentName}</span>
            <span className="text-fg-muted">{pageCount}페이지 · 문서 변경</span>
          </span>
        </button>
      </div>

      <div className="flex flex-wrap gap-2.5">
        <Segmented<RequestType>
          options={[
            { value: "sign", label: "서명" },
            { value: "view", label: "열람" },
          ]}
          value={requestType}
          onChange={onRequestType}
        />
        <Segmented<SigningOrder>
          options={[
            { value: "sequential", label: "순서대로" },
            { value: "parallel", label: "순서없이" },
          ]}
          value={signingOrder}
          onChange={onSigningOrder}
        />
      </div>

      <div className="mt-[18px] space-y-6">
        {roles.map((r, i) => (
          <RoleCard
            key={r.key}
            index={i}
            role={r}
            who={who}
            sequential={sequential}
            canDelete={roles.length >= 2}
            fieldCount={fieldCounts[r.key] ?? 0}
            duplicate={(nameCounts.get(r.name.trim().toLowerCase()) ?? 0) > 1}
            onRename={(name) => onRename(i, name)}
            onDelete={() => onDelete(i)}
            onMove={(dir) => onMove(i, i + dir)}
            setInputEl={(el) => {
              if (el) inputRefs.current.set(r.key, el);
              else inputRefs.current.delete(r.key);
            }}
            setCardEl={(el) => {
              if (el) cardRefs.current.set(r.key, el);
              else cardRefs.current.delete(r.key);
            }}
            dragging={dragIndex === i}
            dropTarget={dragIndex !== null && overIndex === i && dragIndex !== i}
            onHandleDragStart={(e) => {
              setDragIndex(i);
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", String(i));
              const card = cardRefs.current.get(r.key);
              if (card) e.dataTransfer.setDragImage(card, card.offsetWidth / 2, 16);
            }}
            onDragEnd={() => {
              setDragIndex(null);
              setOverIndex(null);
            }}
            onDragOver={(e) => {
              if (dragIndex === null) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              if (overIndex !== i) setOverIndex(i);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragIndex !== null) onMove(dragIndex, i);
              setDragIndex(null);
              setOverIndex(null);
            }}
          />
        ))}
      </div>

      <button
        type="button"
        onClick={add}
        disabled={roles.length >= MAX_ROLES}
        className="mt-6 flex h-[85px] w-full items-center justify-center gap-2 rounded-md bg-btn-dark text-sm font-semibold text-fg-2 transition-colors hover:bg-btn-hover disabled:bg-btn-disabled disabled:text-fg-disabled"
      >
        <Plus className="size-[18px]" />
        {who} 추가
        <span className="font-normal">
          ({roles.length}/{MAX_ROLES})
        </span>
      </button>
    </main>
  );
}
