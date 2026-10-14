"use client";

import { Plus, TextCursorInput, X } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Counter, FieldError, FormRow, FormSection } from "@/components/tools/form-layout";
import { Button } from "@/components/ui/button";
import { Checkbox, Radio } from "@/components/ui/controls";
import { Input, Select } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import {
  CF_LIMITS,
  CUSTOM_FIELD_TYPES,
  validateCustomField,
  type CustomFieldErrors,
  type CustomFieldInput,
  type CustomFieldType,
} from "@/lib/tools/custom-fields";
import type { CustomField } from "@/lib/types";

import { createCustomField, updateCustomField } from "./actions";

type ErrKey = keyof CustomFieldErrors;

/** 새 입력란 만들기 / 입력란 수정 dialog. Mount only while open. */
export function CustomFieldModal({ wid, field, onClose }: { wid: string; field: CustomField | null; onClose: () => void }) {
  const editing = !!field;
  const [name, setName] = useState(field?.name ?? "");
  const [type, setType] = useState<CustomFieldType>(field?.type ?? "text");
  const [required, setRequired] = useState(field?.required ?? false);
  const [placeholder, setPlaceholder] = useState(field?.placeholder ?? "");
  const [defaultValue, setDefaultValue] = useState(field?.default_value ?? "");
  const [items, setItems] = useState<string[]>(field?.options?.length ? field.options : ["", ""]);
  const [touched, setTouched] = useState<Partial<Record<ErrKey, boolean>>>({});
  const [pending, startTransition] = useTransition();

  const filledItems = Array.from(new Set(items.map((i) => i.trim()).filter(Boolean)));
  // a dropdown default that is no longer one of the items is dropped
  const effectiveDefault = type === "dropdown" && !filledItems.includes(defaultValue.trim()) ? "" : defaultValue;
  const input: CustomFieldInput = { name, type, required, placeholder, defaultValue: effectiveDefault, options: items };
  const { values, errors } = validateCustomField(input);
  const err = (k: ErrKey) => (touched[k] ? errors[k] : undefined);
  const touch = (k: ErrKey) => setTouched((t) => ({ ...t, [k]: true }));

  const changeType = (t: CustomFieldType) => {
    setType(t);
    setDefaultValue("");
  };

  const close = () => {
    if (!pending) onClose();
  };

  const submit = () => {
    if (!values || pending) return;
    startTransition(async () => {
      const res = editing ? await updateCustomField(wid, field.id, input) : await createCustomField(wid, input);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(editing ? "맞춤 입력란을 수정했습니다." : "맞춤 입력란을 만들었습니다.");
      onClose();
    });
  };

  return (
    <Modal
      open
      onClose={close}
      width={672}
      icon={<TextCursorInput />}
      title={editing ? "입력란 수정" : "새 입력란 만들기"}
      footer={
        <>
          <Button variant="light" className="min-w-[60px] font-bold" onClick={close} disabled={pending}>
            취소
          </Button>
          <Button
            variant="primary"
            type="submit"
            form="custom-field-form"
            className="min-w-[60px] border border-transparent disabled:border-line"
            disabled={!values || pending}
          >
            {pending ? "저장 중…" : editing ? "저장" : "만들기"}
          </Button>
        </>
      }
    >
      <form
        id="custom-field-form"
        noValidate
        className="px-[30px] pt-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <FormSection className="space-y-4 pt-5">
          <FormRow label="이름" required htmlFor="cf-name">
            <Input
              id="cf-name"
              autoFocus
              value={name}
              maxLength={CF_LIMITS.name}
              placeholder={`${CF_LIMITS.name}자 이내로 입력`}
              invalid={!!err("name")}
              aria-invalid={!!err("name") || undefined}
              onChange={(e) => {
                setName(e.target.value);
                touch("name");
              }}
            />
            <FieldError>{err("name")}</FieldError>
          </FormRow>
          <FormRow label="유형" required>
            <div role="radiogroup" aria-label="입력란 유형" className="flex min-h-9 flex-wrap items-center gap-x-5 gap-y-2">
              {CUSTOM_FIELD_TYPES.map((t) => (
                <Radio key={t.value} name="cf-type" checked={type === t.value} onChange={() => changeType(t.value)} label={t.label} />
              ))}
            </div>
          </FormRow>
          <FormRow label="필수 여부">
            <div className="flex min-h-9 items-center">
              <Checkbox
                checked={required}
                onChange={setRequired}
                label={type === "checkbox" ? "서명자가 반드시 체크하도록 설정" : "서명자가 반드시 입력하도록 설정"}
              />
            </div>
          </FormRow>
        </FormSection>

        <FormSection className="space-y-4 pb-8">
          {type !== "checkbox" && (
            <FormRow label="입력 가이드" htmlFor="cf-placeholder">
              <Input
                id="cf-placeholder"
                value={placeholder}
                maxLength={CF_LIMITS.placeholder}
                placeholder="서명자에게 보여줄 안내 문구 (예: 계약 금액을 입력해 주세요)"
                onChange={(e) => setPlaceholder(e.target.value)}
              />
              <Counter value={placeholder.length} max={CF_LIMITS.placeholder} />
            </FormRow>
          )}

          {type === "dropdown" && (
            <FormRow label="드롭다운 항목" required>
              <ol className="space-y-2">
                {items.map((it, i) => (
                  <li key={i} className="flex items-center gap-1.5">
                    <span aria-hidden className="w-5 shrink-0 text-center text-xs text-fg-faint">
                      {i + 1}
                    </span>
                    <Input
                      aria-label={`${i + 1}번째 항목`}
                      value={it}
                      maxLength={CF_LIMITS.item}
                      placeholder="항목 입력"
                      onChange={(e) => setItems((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))}
                      onBlur={() => touch("options")}
                    />
                    <button
                      type="button"
                      aria-label={`${i + 1}번째 항목 삭제`}
                      disabled={items.length <= 1}
                      onClick={() => {
                        setItems((prev) => prev.filter((_, j) => j !== i));
                        if (defaultValue === it.trim()) setDefaultValue("");
                      }}
                      className="flex size-8 shrink-0 items-center justify-center rounded text-fg-faint hover:bg-btn-light hover:text-fg-2 disabled:opacity-30"
                    >
                      <X className="size-4" />
                    </button>
                  </li>
                ))}
              </ol>
              <button
                type="button"
                disabled={items.length >= CF_LIMITS.items}
                onClick={() => setItems((prev) => [...prev, ""])}
                className="mt-2 flex h-8 items-center gap-1 rounded px-2 text-[13px] font-medium text-emphasis hover:bg-emphasis-bg disabled:text-fg-disabled disabled:hover:bg-transparent"
              >
                <Plus className="size-4" />
                항목 추가
                <span className="ml-1 text-xs font-normal text-fg-muted">
                  ({items.length}/{CF_LIMITS.items})
                </span>
              </button>
              <FieldError>{err("options")}</FieldError>
            </FormRow>
          )}

          <FormRow label="기본값" htmlFor="cf-default">
            {type === "text" && (
              <>
                <Input
                  id="cf-default"
                  value={defaultValue}
                  maxLength={CF_LIMITS.defaultValue}
                  placeholder="미리 채워 둘 값 (선택)"
                  onChange={(e) => setDefaultValue(e.target.value)}
                />
                <Counter value={defaultValue.length} max={CF_LIMITS.defaultValue} />
              </>
            )}
            {type === "number" && (
              <>
                <Input
                  id="cf-default"
                  inputMode="decimal"
                  value={defaultValue}
                  maxLength={30}
                  placeholder="숫자만 입력 (선택)"
                  invalid={!!err("defaultValue")}
                  onChange={(e) => setDefaultValue(e.target.value.replace(/[^\d.-]/g, ""))}
                  onBlur={() => touch("defaultValue")}
                />
                <FieldError>{err("defaultValue")}</FieldError>
              </>
            )}
            {type === "date" && (
              <>
                <Input
                  id="cf-default"
                  type="date"
                  value={defaultValue}
                  invalid={!!err("defaultValue")}
                  onChange={(e) => setDefaultValue(e.target.value)}
                  onBlur={() => touch("defaultValue")}
                  className="w-[200px] [color-scheme:dark]"
                />
                <FieldError>{err("defaultValue")}</FieldError>
              </>
            )}
            {type === "checkbox" && (
              <div className="flex min-h-9 items-center">
                <Checkbox
                  id="cf-default"
                  checked={defaultValue === "true"}
                  onChange={(on) => setDefaultValue(on ? "true" : "")}
                  label="기본으로 체크된 상태로 표시"
                />
              </div>
            )}
            {type === "dropdown" && (
              <>
                <Select
                  id="cf-default"
                  value={effectiveDefault}
                  onChange={(e) => setDefaultValue(e.target.value)}
                  wrapperClassName="w-full"
                >
                  <option value="">선택 안 함</option>
                  {filledItems.map((it) => (
                    <option key={it} value={it}>
                      {it}
                    </option>
                  ))}
                </Select>
                <FieldError>{err("defaultValue")}</FieldError>
              </>
            )}
          </FormRow>
        </FormSection>
      </form>
    </Modal>
  );
}
