"use client";

import { BookUser, CircleHelp } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { EmailAutocompleteInput } from "@/components/tools/email-input";
import { Counter, FieldError, FormRow, FormSection, RequiredMark } from "@/components/tools/form-layout";
import { Button } from "@/components/ui/button";
import { Checkbox, Radio } from "@/components/ui/controls";
import { Input, Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import {
  CONTACT_LIMITS,
  digitsOnly,
  phoneSuffix,
  validateContact,
  type ContactChannel,
  type ContactErrorKey,
  type ContactInput,
} from "@/lib/tools/contacts";
import type { Contact } from "@/lib/types";
import { cn } from "@/lib/utils";

import { createContact, updateContact } from "./actions";

/** 새 연락처 / 연락처 수정 dialog. Mount it only while open (state is initialised from `contact`). */
export function ContactModal({ wid, contact, onClose }: { wid: string; contact: Contact | null; onClose: () => void }) {
  const editing = !!contact;
  const [name, setName] = useState(contact?.name ?? "");
  const [channel, setChannel] = useState<ContactChannel | null>(contact?.default_channel ?? null);
  const [phone, setPhone] = useState(phoneSuffix(contact?.phone));
  const [email, setEmail] = useState(contact?.email ?? "");
  const [description, setDescription] = useState(contact?.description ?? "");
  const [extra, setExtra] = useState(!!(contact?.company || contact?.position || contact?.business_no));
  const [company, setCompany] = useState(contact?.company ?? "");
  const [position, setPosition] = useState(contact?.position ?? "");
  const [businessNo, setBusinessNo] = useState(contact?.business_no ?? "");
  const [touched, setTouched] = useState<Partial<Record<ContactErrorKey, boolean>>>({});
  const [pending, startTransition] = useTransition();

  // the radio shows what will be stored: explicit choice, otherwise the first filled channel
  const effectiveChannel: ContactChannel | null = channel ?? (phone ? "phone" : email.trim() ? "email" : null);

  const input: ContactInput = {
    name,
    phone,
    email,
    defaultChannel: effectiveChannel,
    description,
    company: extra ? company : "",
    position: extra ? position : "",
    businessNo: extra ? businessNo : "",
  };
  const { values, errors } = validateContact(input);
  const err = (k: ContactErrorKey) => (touched[k] ? errors[k] : undefined);
  const touch = (k: ContactErrorKey) => setTouched((t) => ({ ...t, [k]: true }));
  const channelError = touched.phone && touched.email ? errors.channel : undefined;

  const close = () => {
    if (!pending) onClose();
  };

  const submit = () => {
    if (!values || pending) return;
    startTransition(async () => {
      const res = editing ? await updateContact(wid, contact.id, input) : await createContact(wid, input);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(editing ? "연락처를 수정했습니다." : "연락처를 추가했습니다.");
      onClose();
    });
  };

  return (
    <Modal
      open
      onClose={close}
      width={672}
      icon={<BookUser />}
      title={editing ? "연락처 수정" : "새 연락처"}
      footer={
        <>
          <Button variant="light" className="min-w-[60px] font-bold" onClick={close} disabled={pending}>
            취소
          </Button>
          <Button
            variant="primary"
            type="submit"
            form="contact-form"
            className="min-w-[60px] border border-transparent disabled:border-line"
            disabled={!values || pending}
          >
            {pending ? "저장 중…" : editing ? "저장" : "추가"}
          </Button>
        </>
      }
    >
      <form
        id="contact-form"
        noValidate
        className="px-[30px] pt-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <FormSection className="pt-5">
          <FormRow label="이름" required htmlFor="contact-name">
            <Input
              id="contact-name"
              autoFocus
              value={name}
              maxLength={CONTACT_LIMITS.name}
              placeholder="30자 이내로 입력"
              invalid={!!err("name")}
              aria-invalid={!!err("name") || undefined}
              aria-describedby={err("name") ? "contact-name-error" : undefined}
              onChange={(e) => {
                setName(e.target.value);
                touch("name");
              }}
            />
            <FieldError id="contact-name-error">{err("name")}</FieldError>
          </FormRow>
        </FormSection>

        <FormSection>
          <p className="text-sm font-medium text-fg">
            전자계약 수신처
            <RequiredMark />
            <span className="ml-1.5 text-xs font-normal text-fg-muted">최소 한 개 입력</span>
          </p>
          <div className="mt-4 space-y-3">
            <div className="flex items-start">
              <div className="flex w-[108px] shrink-0 items-start justify-between gap-1 pr-3 text-sm font-medium leading-[18px] text-fg">
                <span id="contact-channel-label" className="break-keep">
                  기본 전송 수단
                </span>
                <span
                  role="img"
                  aria-label="서명 요청을 보낼 때 기본으로 사용할 전송 수단입니다."
                  title="서명 요청을 보낼 때 기본으로 사용할 전송 수단입니다."
                  className="mt-0.5 shrink-0 cursor-help text-fg-faint"
                >
                  <CircleHelp aria-hidden className="size-3.5" />
                </span>
              </div>
              <div role="radiogroup" aria-labelledby="contact-channel-label" className="flex min-h-9 flex-1 flex-col justify-center">
                <div className="flex items-center gap-4">
                  <Radio name="contact-channel" checked={effectiveChannel === "phone"} onChange={() => setChannel("phone")} label="휴대폰" />
                  <Radio name="contact-channel" checked={effectiveChannel === "email"} onChange={() => setChannel("email")} label="이메일" />
                </div>
                <FieldError>{errors.defaultChannel && (touched.phone || touched.email) ? errors.defaultChannel : undefined}</FieldError>
              </div>
            </div>
            <FormRow label="휴대폰" htmlFor="contact-phone">
              <div
                className={cn(
                  "flex h-9 items-center rounded border border-transparent bg-surface shadow-input focus-within:border-emphasis focus-within:shadow-focus",
                  err("phone") && "border-negative",
                )}
              >
                <span className="select-none pl-3 text-sm font-bold text-fg">010-</span>
                <input
                  id="contact-phone"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={8}
                  placeholder="8자리 숫자만 입력"
                  value={phone}
                  aria-invalid={!!err("phone") || undefined}
                  onChange={(e) => setPhone(digitsOnly(e.target.value).slice(0, 8))}
                  onBlur={() => touch("phone")}
                  className="h-full min-w-0 flex-1 bg-transparent pl-0.5 pr-3 text-sm text-fg outline-none"
                />
              </div>
              <FieldError>{err("phone")}</FieldError>
            </FormRow>
            <FormRow label="이메일" htmlFor="contact-email">
              <div onBlur={() => touch("email")}>
                <EmailAutocompleteInput id="contact-email" value={email} onChange={setEmail} invalid={!!err("email")} />
              </div>
              <FieldError>{err("email") ?? channelError}</FieldError>
            </FormRow>
          </div>
        </FormSection>

        <FormSection>
          <FormRow label="설명" htmlFor="contact-description">
            <Textarea
              id="contact-description"
              value={description}
              maxLength={CONTACT_LIMITS.description}
              placeholder="100자 이하로 입력"
              className="h-[100px]"
              onChange={(e) => setDescription(e.target.value)}
            />
            <Counter value={description.length} max={CONTACT_LIMITS.description} />
          </FormRow>
        </FormSection>

        <FormSection className="pb-8">
          <div className="flex min-h-9 items-center justify-between gap-4">
            <p className="text-sm font-medium text-fg">
              부가정보
              <span className="ml-1.5 text-xs font-normal text-fg-muted">회사명, 직위, 사업자등록번호 등</span>
            </p>
            <Checkbox checked={extra} onChange={setExtra} label="추가 입력" className="[&>span:last-child]:font-bold" />
          </div>
          {extra && (
            <div className="mt-4 space-y-3">
              <FormRow label="회사명" htmlFor="contact-company">
                <Input
                  id="contact-company"
                  value={company}
                  maxLength={CONTACT_LIMITS.company}
                  placeholder="50자 이내로 입력"
                  onChange={(e) => setCompany(e.target.value)}
                />
              </FormRow>
              <FormRow label="직위" htmlFor="contact-position">
                <Input
                  id="contact-position"
                  value={position}
                  maxLength={CONTACT_LIMITS.position}
                  placeholder="30자 이내로 입력"
                  onChange={(e) => setPosition(e.target.value)}
                />
              </FormRow>
              <FormRow label="사업자등록번호" htmlFor="contact-business">
                <Input
                  id="contact-business"
                  inputMode="numeric"
                  value={businessNo}
                  maxLength={12}
                  placeholder="10자리 숫자 입력"
                  invalid={!!err("businessNo")}
                  onChange={(e) => setBusinessNo(e.target.value.replace(/[^\d-]/g, ""))}
                  onBlur={() => touch("businessNo")}
                />
                <FieldError>{err("businessNo")}</FieldError>
              </FormRow>
            </div>
          )}
        </FormSection>
      </form>
    </Modal>
  );
}
