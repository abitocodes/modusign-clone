"use client";

import { Plus, Tag } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/controls";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import type { Label } from "@/lib/types";
import { cn, PARTICIPANT_COLORS } from "@/lib/utils";

export type CreateLabelFn = (name: string, color: string) => Promise<{ ok: true; label: Label } | { ok: false; error: string }>;

/** 라벨 설정 — pick workspace labels (multi) and create new ones. Mount it only while open. */
export function LabelPickerModal({
  labels: initialLabels,
  value,
  description,
  onClose,
  onSave,
  onCreate,
  onLabelsChange,
}: {
  labels: Label[];
  value: string[];
  description?: string;
  onClose: () => void;
  onSave: (ids: string[]) => void;
  onCreate: CreateLabelFn;
  /** called with the full list after a label was created */
  onLabelsChange?: (labels: Label[]) => void;
}) {
  const [labels, setLabels] = useState(initialLabels);
  const [picked, setPicked] = useState<string[]>(value.filter((id) => initialLabels.some((l) => l.id === id)));
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(PARTICIPANT_COLORS[initialLabels.length % PARTICIPANT_COLORS.length]);
  const [creating, startCreate] = useTransition();

  const toggle = (id: string, on: boolean) => setPicked((cur) => (on ? [...cur, id] : cur.filter((x) => x !== id)));

  const create = () => {
    const n = name.trim();
    if (!n || creating) return;
    startCreate(async () => {
      const res = await onCreate(n, color);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      const next = labels.some((l) => l.id === res.label.id) ? labels : [...labels, res.label].sort((a, b) => a.name.localeCompare(b.name, "ko"));
      setLabels(next);
      onLabelsChange?.(next);
      setPicked((cur) => (cur.includes(res.label.id) ? cur : [...cur, res.label.id]));
      setName("");
      setColor(PARTICIPANT_COLORS[next.length % PARTICIPANT_COLORS.length]);
    });
  };

  return (
    <Modal
      open
      onClose={onClose}
      width={460}
      title="라벨 설정"
      icon={<Tag />}
      footerBar
      footer={
        <>
          <Button variant="light" onClick={onClose}>
            취소
          </Button>
          <Button variant="primary" onClick={() => onSave(picked)}>
            적용
          </Button>
        </>
      }
    >
      <div className="px-[30px] py-6">
        <p className="text-[13px] text-fg-muted">{description ?? "적용할 라벨을 선택하세요."}</p>

        <div className="mt-4 max-h-[260px] overflow-y-auto rounded border border-line bg-surface-3">
          {labels.length === 0 ? (
            <p className="px-4 py-8 text-center text-[13px] text-fg-muted">아직 만든 라벨이 없습니다. 아래에서 새 라벨을 만들어 보세요.</p>
          ) : (
            <ul>
              {labels.map((l) => (
                <li key={l.id} className="border-b border-line-light last:border-b-0">
                  <Checkbox
                    className="flex h-10 w-full px-3.5 hover:bg-surface-4"
                    checked={picked.includes(l.id)}
                    onChange={(on) => toggle(l.id, on)}
                    label={
                      <span className="flex items-center gap-2">
                        <span className="size-2.5 rounded-full" style={{ background: l.color }} aria-hidden />
                        {l.name}
                      </span>
                    }
                  />
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-5">
          <p className="mb-1.5 text-[13px] font-medium text-fg-muted">새 라벨 만들기</p>
          <div className="flex gap-2">
            <Input
              value={name}
              maxLength={20}
              placeholder="라벨 이름 (20자 이내)"
              aria-label="새 라벨 이름"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  create();
                }
              }}
              left={<span className="size-2.5 rounded-full" style={{ background: color }} />}
            />
            <Button variant="outline" icon={<Plus className="size-4" />} onClick={create} disabled={!name.trim() || creating}>
              추가
            </Button>
          </div>
          <div className="mt-2.5 flex gap-1.5" role="radiogroup" aria-label="라벨 색상">
            {PARTICIPANT_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color === c}
                aria-label={`색상 ${c}`}
                onClick={() => setColor(c)}
                className={cn("size-5 rounded-full ring-offset-2 ring-offset-modal", color === c && "ring-2 ring-fg-2")}
                style={{ background: c }}
              />
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
