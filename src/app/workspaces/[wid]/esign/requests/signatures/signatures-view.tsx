"use client";

import { EllipsisVertical, PenLine, Plus, Star, Trash2, Users } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { SignatureDialog, StampDialog } from "@/components/signature";
import { FilterChip, Chip } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ListPage, ListTitle } from "@/components/ui/list-page";
import { Dropdown, MenuDivider, MenuItem } from "@/components/ui/menu";
import { ConfirmModal, Modal } from "@/components/ui/modal";
import type { SignatureKind } from "@/lib/types";
import { cn, fmtDate } from "@/lib/utils";

import { createSignature, deleteSignature, renameSignature, setDefaultSignature, setSignatureShared } from "./actions";

export interface SignatureItem {
  id: string;
  kind: SignatureKind;
  name: string;
  image_data: string;
  is_default: boolean;
  shared: boolean;
  created_at: string;
  /** registered by the current user (only those can be edited) */
  mine: boolean;
  owner_name: string;
}

const KIND_LABEL: Record<SignatureKind, string> = { sign: "사인", stamp: "도장" };
const NAME_MAX = 30;

type Scope = "all" | "mine";

export function SignaturesView({
  wid,
  items,
  myName,
  companyName,
  canShare,
}: {
  wid: string;
  items: SignatureItem[];
  myName: string;
  companyName: string;
  canShare: boolean;
}) {
  const [scope, setScope] = useState<Scope>("all");
  const [dialog, setDialog] = useState<SignatureKind | null>(null);
  const [renaming, setRenaming] = useState<SignatureItem | null>(null);
  const [deleting, setDeleting] = useState<SignatureItem | null>(null);
  const [pending, startTransition] = useTransition();

  const visible = scope === "mine" ? items.filter((i) => i.mine) : items;

  const register = (kind: SignatureKind) => async (png: string) => {
    const res = await createSignature(wid, { kind, imageData: png });
    if (!res.ok) throw new Error(res.error);
    toast.success(`${KIND_LABEL[kind]}을 등록했습니다.`);
  };

  const run = (job: () => Promise<{ ok: true } | { ok: false; error: string }>, success: string) =>
    startTransition(async () => {
      const res = await job();
      if (res.ok) toast.success(success);
      else toast.error(res.error);
    });

  return (
    <ListPage>
      <ListTitle
        title="사인·도장"
        chips={
          <>
            <FilterChip active={scope === "all"} onClick={() => setScope("all")}>
              전체
            </FilterChip>
            <FilterChip active={scope === "mine"} onClick={() => setScope("mine")}>
              내 사인·도장
            </FilterChip>
          </>
        }
        actions={
          <>
            <Button variant="neutral" icon={<Plus className="size-4" />} onClick={() => setDialog("sign")}>
              사인 등록
            </Button>
            <Button variant="neutral" icon={<Plus className="size-4" />} onClick={() => setDialog("stamp")}>
              도장 등록
            </Button>
          </>
        }
      />

      {visible.length === 0 ? (
        <div className="mt-5 flex h-[282px] flex-col items-center justify-center border border-line px-4 text-center">
          <EmptyIllustration />
          <p className="mt-[22px] text-sm leading-[1.45] text-fg-muted">
            이용 가능한 사인·도장이 없습니다.
            <br />
            사인·도장을 등록해 보세요.
          </p>
        </div>
      ) : (
        <ul className={cn("mt-5 grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4", pending && "opacity-80")} aria-busy={pending}>
          {visible.map((item) => (
            <li key={item.id}>
              <SignatureCard
                item={item}
                canShare={canShare}
                disabled={pending}
                onDefault={() => run(() => setDefaultSignature(wid, item.id), `기본 ${KIND_LABEL[item.kind]}으로 설정했습니다.`)}
                onRename={() => setRenaming(item)}
                onShare={(shared) =>
                  run(
                    () => setSignatureShared(wid, item.id, shared),
                    shared ? "워크스페이스 멤버에게 도장을 공유했습니다." : "도장 공유를 해제했습니다.",
                  )
                }
                onDelete={() => setDeleting(item)}
              />
            </li>
          ))}
        </ul>
      )}

      <SignatureDialog open={dialog === "sign"} onClose={() => setDialog(null)} onSubmit={register("sign")} defaultName={myName} />
      <StampDialog
        open={dialog === "stamp"}
        onClose={() => setDialog(null)}
        onSubmit={register("stamp")}
        defaultName={myName}
        defaultCompany={companyName}
      />

      <RenameModal
        key={renaming?.id ?? "none"}
        item={renaming}
        onClose={() => setRenaming(null)}
        onSave={async (name) => {
          if (!renaming) return;
          const res = await renameSignature(wid, renaming.id, name);
          if (!res.ok) {
            toast.error(res.error);
            return;
          }
          toast.success("이름을 변경했습니다.");
          setRenaming(null);
        }}
      />

      <ConfirmModal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        danger
        title={`${deleting ? KIND_LABEL[deleting.kind] : ""}을 삭제할까요?`}
        description={
          <>
            &lsquo;{deleting?.name}&rsquo;을(를) 삭제하면 다시 되돌릴 수 없습니다.
            {deleting?.is_default && (
              <>
                <br />
                기본 {KIND_LABEL[deleting.kind]}은 가장 최근에 등록한 {KIND_LABEL[deleting.kind]}으로 바뀝니다.
              </>
            )}
          </>
        }
        confirmLabel="삭제"
        onConfirm={() => {
          const target = deleting;
          if (target) run(() => deleteSignature(wid, target.id), `${KIND_LABEL[target.kind]}을 삭제했습니다.`);
        }}
      />
    </ListPage>
  );
}

function SignatureCard({
  item,
  canShare,
  disabled,
  onDefault,
  onRename,
  onShare,
  onDelete,
}: {
  item: SignatureItem;
  canShare: boolean;
  disabled: boolean;
  onDefault: () => void;
  onRename: () => void;
  onShare: (shared: boolean) => void;
  onDelete: () => void;
}) {
  const meta = [KIND_LABEL[item.kind], fmtDate(item.created_at)];
  if (!item.mine) meta.push(`${item.owner_name} 공유`);
  else if (item.shared) meta.push("멤버 공유 중");

  return (
    <article className="flex flex-col rounded border border-line bg-surface-2">
      <div className="flex h-[150px] items-center justify-center rounded-t bg-canvas p-4">
        {/* eslint-disable-next-line @next/next/no-img-element -- stored PNG data URL */}
        <img
          src={item.image_data}
          alt={`${item.name} ${KIND_LABEL[item.kind]} 이미지`}
          className={cn("max-w-[85%] object-contain", item.kind === "stamp" ? "max-h-[100px]" : "max-h-[96px]")}
        />
      </div>
      <div className="flex h-[58px] items-center gap-2 border-t border-line-light pl-3.5 pr-1.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-sm font-medium text-fg-2" title={item.name}>
              {item.name}
            </p>
            {item.is_default && (
              <Chip tone="emphasis" className="h-5 shrink-0 px-1.5 text-[11px]">
                기본
              </Chip>
            )}
          </div>
          <p className="mt-0.5 truncate text-xs text-fg-faint">{meta.join(" · ")}</p>
        </div>
        {item.mine && (
          <Dropdown
            align="right"
            panelClassName="min-w-[184px]"
            trigger={(open, toggle) => (
              <button
                type="button"
                aria-label={`${item.name} 메뉴`}
                aria-haspopup="menu"
                aria-expanded={open}
                disabled={disabled}
                onClick={toggle}
                className={cn(
                  "flex size-8 items-center justify-center rounded text-icon-2 hover:bg-btn-light disabled:opacity-50",
                  open && "bg-btn-light",
                )}
              >
                <EllipsisVertical className="size-[18px]" />
              </button>
            )}
          >
            {(close) => (
              <>
                <MenuItem
                  icon={<Star />}
                  disabled={item.is_default}
                  onClick={() => {
                    close();
                    onDefault();
                  }}
                >
                  기본으로 설정
                </MenuItem>
                <MenuItem
                  icon={<PenLine />}
                  onClick={() => {
                    close();
                    onRename();
                  }}
                >
                  이름 변경
                </MenuItem>
                {canShare && item.kind === "stamp" && (
                  <MenuItem
                    icon={<Users />}
                    caption={item.shared ? undefined : "멤버도 서명에 사용할 수 있습니다."}
                    onClick={() => {
                      close();
                      onShare(!item.shared);
                    }}
                  >
                    {item.shared ? "공유 해제" : "멤버에게 공유"}
                  </MenuItem>
                )}
                <MenuDivider />
                <MenuItem
                  icon={<Trash2 />}
                  danger
                  onClick={() => {
                    close();
                    onDelete();
                  }}
                >
                  삭제
                </MenuItem>
              </>
            )}
          </Dropdown>
        )}
      </div>
    </article>
  );
}

function RenameModal({ item, onClose, onSave }: { item: SignatureItem | null; onClose: () => void; onSave: (name: string) => Promise<void> }) {
  const [name, setName] = useState(item?.name ?? "");
  const [saving, setSaving] = useState(false);
  const value = name.trim();
  const valid = value.length > 0 && value.length <= NAME_MAX && value !== item?.name;

  const save = async () => {
    if (!valid || saving) return;
    setSaving(true);
    try {
      await onSave(value);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={!!item}
      onClose={onClose}
      title="이름 변경"
      width={420}
      footer={
        <>
          <Button variant="light" size="lg" className="h-10" onClick={onClose}>
            취소
          </Button>
          <Button variant="primary" size="lg" className="h-10" disabled={!valid || saving} onClick={() => void save()}>
            변경
          </Button>
        </>
      }
    >
      <div className="px-[30px] pb-2 pt-6">
        <label className="mb-2 block text-[13px] font-medium text-fg-2" htmlFor="signature-name">
          {item ? KIND_LABEL[item.kind] : ""} 이름
        </label>
        <Input
          id="signature-name"
          autoFocus
          value={name}
          maxLength={NAME_MAX}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void save();
            }
          }}
          placeholder="이름을 입력해 주세요."
          className="border-line"
        />
        <p className="mt-1.5 text-right text-[11px] text-fg-muted">
          {name.length}/{NAME_MAX}
        </p>
      </div>
    </Modal>
  );
}

/** Original illustration: two sheets, a pen signature and a red seal. */
function EmptyIllustration() {
  return (
    <svg width="136" height="104" viewBox="0 0 136 104" fill="none" aria-hidden className="shrink-0">
      {/* back sheet */}
      <rect x="54" y="6" width="58" height="76" rx="3" className="fill-slate-400" />
      {/* front sheet with folded corner */}
      <path d="M36 18a3 3 0 0 1 3-3h41l17 17v62a3 3 0 0 1-3 3H39a3 3 0 0 1-3-3V18Z" className="fill-black/30" transform="translate(2 2)" />
      <path d="M36 18a3 3 0 0 1 3-3h41l17 17v62a3 3 0 0 1-3 3H39a3 3 0 0 1-3-3V18Z" className="fill-neutral-50" />
      <path d="M80 15v14a3 3 0 0 0 3 3h14L80 15Z" className="fill-neutral-400" />
      <rect x="46" y="38" width="38" height="3" rx="1.5" className="fill-neutral-300" />
      <rect x="46" y="46" width="38" height="3" rx="1.5" className="fill-neutral-300" />
      <rect x="46" y="54" width="24" height="3" rx="1.5" className="fill-neutral-300" />
      {/* pen signature */}
      <path
        d="M48 84c3-1 5-9 8-12 2-2 3 0 2 3-1 4-3 8-1 8 3 0 4-7 7-7 2 0 1 5 3 5s3-4 6-4c2 0 2 2 5 1"
        className="stroke-neutral-600"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* red seal */}
      <circle cx="104" cy="76" r="17" className="fill-red-500/10 stroke-red-600" strokeWidth="2.2" />
      <path
        d="M95 67h7v7h-7zM106 67h8M110 67v8M106 75h8M95 79h8M99 79v8M95 87h8M106 80h7v7h-7z"
        className="stroke-red-600"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
