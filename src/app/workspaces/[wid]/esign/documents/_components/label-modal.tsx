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

import { createLabel, setDocumentLabels } from "../actions";

/** 라벨 설정 — pick existing workspace labels or create new ones. */
export function LabelModal({
  wid,
  doc,
  labels,
  onClose,
}: {
  wid: string;
  doc: { id: string; title: string; label_ids: string[] } | null;
  labels: Label[];
  onClose: () => void;
}) {
  return doc ? <LabelModalInner key={doc.id} wid={wid} doc={doc} labels={labels} onClose={onClose} /> : null;
}

function LabelModalInner({
  wid,
  doc,
  labels: initialLabels,
  onClose,
}: {
  wid: string;
  doc: { id: string; title: string; label_ids: string[] };
  labels: Label[];
  onClose: () => void;
}) {
  const [labels, setLabels] = useState(initialLabels);
  const [picked, setPicked] = useState<string[]>(doc.label_ids.filter((id) => initialLabels.some((l) => l.id === id)));
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(PARTICIPANT_COLORS[initialLabels.length % PARTICIPANT_COLORS.length]);
  const [creating, startCreate] = useTransition();
  const [saving, startSave] = useTransition();

  const toggle = (id: string, on: boolean) => setPicked((cur) => (on ? [...cur, id] : cur.filter((x) => x !== id)));

  const create = () => {
    const n = name.trim();
    if (!n) return;
    startCreate(async () => {
      const res = await createLabel(wid, n, color);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setLabels((cur) => (cur.some((l) => l.id === res.label.id) ? cur : [...cur, res.label].sort((a, b) => a.name.localeCompare(b.name, "ko"))));
      setPicked((cur) => (cur.includes(res.label.id) ? cur : [...cur, res.label.id]));
      setName("");
      setColor(PARTICIPANT_COLORS[(labels.length + 1) % PARTICIPANT_COLORS.length]);
    });
  };

  const save = () =>
    startSave(async () => {
      const res = await setDocumentLabels(wid, doc.id, picked);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("라벨을 저장했습니다.");
      onClose();
    });

  return (
    <Modal
      open
      onClose={() => !saving && onClose()}
      width={460}
      title="라벨 설정"
      icon={<Tag />}
      footerBar
      footer={
        <>
          <Button variant="light" onClick={onClose} disabled={saving}>
            취소
          </Button>
          <Button variant="primary" onClick={save} disabled={saving}>
            {saving ? "저장하는 중…" : "저장"}
          </Button>
        </>
      }
    >
      <div className="px-[30px] py-6">
        <p className="truncate text-[13px] text-fg-muted">
          <span className="font-bold text-fg-2">{doc.title}</span> 문서에 붙일 라벨을 선택하세요.
        </p>

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
