"use client";

import { Calendar, CircleHelp, Hash, List, Pencil, Plus, SquareCheck, Trash2, Type, type LucideIcon } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { RowMenu } from "@/components/tools/row-menu";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/controls";
import { Cell, ListPage, ListTitle, TableHeader, TableRow, type Column } from "@/components/ui/list-page";
import { MenuItem } from "@/components/ui/menu";
import { ConfirmModal } from "@/components/ui/modal";
import { CUSTOM_FIELD_LIMIT, CUSTOM_FIELD_TYPE_LABEL, customFieldDefaultLabel, type CustomFieldType } from "@/lib/tools/custom-fields";
import type { CustomField } from "@/lib/types";
import { fmtDate } from "@/lib/utils";

import { deleteCustomField } from "./actions";
import { CustomFieldModal } from "./custom-field-modal";

const TYPE_ICON: Record<CustomFieldType, LucideIcon> = {
  text: Type,
  number: Hash,
  date: Calendar,
  checkbox: SquareCheck,
  dropdown: List,
};

const COLUMNS: Column[] = [
  { key: "name", label: "입력란 이름" },
  { key: "type", label: "유형", width: 120 },
  { key: "required", label: "필수", width: 80 },
  { key: "placeholder", label: "입력 가이드", width: 240 },
  { key: "default", label: "기본값", width: 160 },
  { key: "created", label: "생성일", width: 110 },
  { key: "menu", label: "추가 메뉴", width: 84, align: "center" },
];

export function CustomFieldsView({ wid, fields }: { wid: string; fields: CustomField[] }) {
  const [editor, setEditor] = useState<{ field: CustomField | null } | null>(null);
  const [toDelete, setToDelete] = useState<CustomField | null>(null);
  const [, startDelete] = useTransition();
  const count = fields.length;
  const full = count >= CUSTOM_FIELD_LIMIT;

  const runDelete = (f: CustomField) =>
    startDelete(async () => {
      const res = await deleteCustomField(wid, f.id);
      if (!res.ok) toast.error(res.error);
      else toast.success(`'${f.name}' 입력란을 삭제했습니다.`);
    });

  return (
    <ListPage>
      <ListTitle
        title="맞춤 입력란"
        actions={
          <>
            <div
              className="flex h-9 items-center gap-2.5 rounded border border-line-strong px-3 text-[13px] text-fg-2"
              role="group"
              aria-label={`맞춤 입력란 ${count}개 / 최대 ${CUSTOM_FIELD_LIMIT}개`}
            >
              <span aria-hidden className="text-fg-2">
                입력란
              </span>
              <span
                role="img"
                aria-label={`워크스페이스당 최대 ${CUSTOM_FIELD_LIMIT}개까지 만들 수 있습니다.`}
                title={`워크스페이스당 최대 ${CUSTOM_FIELD_LIMIT}개까지 만들 수 있습니다.`}
                className="cursor-help text-fg-faint"
              >
                <CircleHelp aria-hidden className="size-3.5" />
              </span>
              <ProgressBar value={count} max={CUSTOM_FIELD_LIMIT} className="h-1 w-16" />
              <span aria-hidden className="tabular-nums">
                <b className="font-bold text-fg">{count}</b> / {CUSTOM_FIELD_LIMIT}
              </span>
            </div>
            <Button
              variant="neutral"
              icon={<Plus className="size-4" />}
              disabled={full}
              title={full ? `맞춤 입력란은 최대 ${CUSTOM_FIELD_LIMIT}개까지 만들 수 있습니다.` : undefined}
              onClick={() => setEditor({ field: null })}
            >
              새 입력란 만들기
            </Button>
          </>
        }
      />

      {count === 0 ? (
        <p className="mt-[100px] text-center text-sm text-fg-2">생성된 맞춤 입력란이 없습니다.</p>
      ) : (
        <div role="table" aria-label="맞춤 입력란 목록" className="mt-2">
          <TableHeader columns={COLUMNS} />
          {fields.map((f) => {
            const Icon = TYPE_ICON[f.type] ?? Type;
            return (
              <TableRow key={f.id} onClick={() => setEditor({ field: f })}>
                <Cell>
                  <p className="truncate text-fg">{f.name}</p>
                  {f.type === "dropdown" && f.options.length > 0 && (
                    <p className="mt-0.5 truncate text-xs text-fg-muted">항목: {f.options.join(", ")}</p>
                  )}
                </Cell>
                <Cell width={120}>
                  <span className="inline-flex items-center gap-1.5 text-fg-2">
                    <Icon aria-hidden className="size-3.5 text-fg-faint" />
                    {CUSTOM_FIELD_TYPE_LABEL[f.type] ?? f.type}
                  </span>
                </Cell>
                <Cell width={80}>
                  {f.required ? (
                    <span className="inline-flex h-[22px] items-center rounded-full border border-warning-border bg-warning-bg px-2 text-xs font-medium text-warning">
                      필수
                    </span>
                  ) : (
                    <span className="text-[13px] text-fg-muted">선택</span>
                  )}
                </Cell>
                <Cell width={240} className="truncate text-[13px] text-fg-2">
                  {f.type === "checkbox" ? "-" : f.placeholder || "-"}
                </Cell>
                <Cell width={160} className="truncate text-[13px] text-fg-2">
                  {customFieldDefaultLabel(f)}
                </Cell>
                <Cell width={110} className="text-[13px] text-fg-2">
                  {fmtDate(f.created_at)}
                </Cell>
                <Cell width={84} align="center">
                  <RowMenu label={`${f.name} 추가 메뉴`}>
                    {(close) => (
                      <>
                        <MenuItem
                          icon={<Pencil />}
                          onClick={() => {
                            close();
                            setEditor({ field: f });
                          }}
                        >
                          수정
                        </MenuItem>
                        <MenuItem
                          icon={<Trash2 />}
                          danger
                          onClick={() => {
                            close();
                            setToDelete(f);
                          }}
                        >
                          삭제
                        </MenuItem>
                      </>
                    )}
                  </RowMenu>
                </Cell>
              </TableRow>
            );
          })}
        </div>
      )}

      {editor && <CustomFieldModal key={editor.field?.id ?? "new"} wid={wid} field={editor.field} onClose={() => setEditor(null)} />}
      <ConfirmModal
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={() => toDelete && runDelete(toDelete)}
        title="맞춤 입력란을 삭제할까요?"
        description={
          toDelete ? (
            <>
              <b className="font-bold text-fg">{toDelete.name}</b> 입력란을 삭제합니다.
              <br />이미 문서에 배치된 입력란에는 영향을 주지 않습니다.
            </>
          ) : undefined
        }
        confirmLabel="삭제"
        danger
      />
    </ListPage>
  );
}
