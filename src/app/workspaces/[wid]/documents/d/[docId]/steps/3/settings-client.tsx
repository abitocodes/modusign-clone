"use client";

import { Bell, ChevronDown, Clock, FileText, Loader2, Lock, Paperclip, Share2, Tag, Users, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Checkbox } from "@/components/ui/controls";
import { FilledField, Input } from "@/components/ui/input";
import { Dropdown, MenuItem } from "@/components/ui/menu";
import { WizardHeader } from "@/components/wizard/wizard-header";
import { createClient } from "@/lib/supabase/client";
import { BUCKET } from "@/lib/storage";
import type { DeliveryMethod, DocumentAttachment, DocumentCc, Label, RequestType } from "@/lib/types";
import { bytesLabel, cn } from "@/lib/utils";

import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS, uuid, type RequestSettingsInput } from "../../../_lib/types";
import { addAttachment, prepareSend, removeAttachment, saveRequestSettings, scheduleSend, sendNow } from "./actions";
import { CcModal, LabelModal, LabelWarningModal, ScheduleModal, SendConfirmModal } from "./settings-modals";

const SKIP_LABEL_WARNING_KEY = "opensign:skip-label-warning";

export interface ConfirmParticipant {
  id: string;
  name: string;
  email: string | null;
  delivery: DeliveryMethod | null;
}

interface Initial {
  title: string;
  expiresDays: number;
  lockPassword: string | null;
  labelIds: string[];
  cc: DocumentCc[];
  attachments: DocumentAttachment[];
}

function readSkipLabelWarning() {
  try {
    return window.localStorage.getItem(SKIP_LABEL_WARNING_KEY) === "1";
  } catch {
    return false;
  }
}
function writeSkipLabelWarning() {
  try {
    window.localStorage.setItem(SKIP_LABEL_WARNING_KEY, "1");
  } catch {
    /* storage unavailable */
  }
}

/* ------------------------------------------------------------ layout bits */

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section aria-label={label}>
      <h2 className="px-1.5 pb-2 text-[13px] font-medium text-fg-muted">{label}</h2>
      <div className="rounded-xl border border-line-strong bg-surface">{children}</div>
    </section>
  );
}

function Row({ icon, title, desc, control, children }: { icon: ReactNode; title: string; desc: ReactNode; control?: ReactNode; children?: ReactNode }) {
  return (
    <div className="border-t border-line-light px-6 py-[26px] first:border-t-0">
      <div className="flex items-center gap-4">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-4 text-icon-2 [&_svg]:size-[18px]" aria-hidden>
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-bold text-fg">{title}</p>
          <p className="mt-0.5 text-[13px] text-fg-muted">{desc}</p>
        </div>
        {control}
      </div>
      {children && <div className="mt-4 pl-[52px]">{children}</div>}
    </div>
  );
}

function SmallButton({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="h-[30px] shrink-0 rounded border border-line-strong bg-btn-light px-2.5 text-[13px] font-semibold text-fg-2 hover:bg-btn-base disabled:text-fg-disabled"
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ page */

export function SettingsClient({
  wid,
  docId,
  requestType,
  initial,
  participants,
  labels: initialLabels,
}: {
  wid: string;
  docId: string;
  requestType: RequestType;
  initial: Initial;
  participants: ConfirmParticipant[];
  labels: Label[];
}) {
  const router = useRouter();
  const base = `/workspaces/${wid}`;
  const view = requestType === "view";
  const verb = view ? "열람" : "서명";

  const [title, setTitle] = useState(initial.title);
  const [expires, setExpires] = useState(String(initial.expiresDays));
  const [lockEnabled, setLockEnabled] = useState(!!initial.lockPassword);
  const [lockPassword, setLockPassword] = useState(initial.lockPassword ?? "");
  const [labelIds, setLabelIds] = useState<string[]>(initial.labelIds);
  const [labels, setLabels] = useState<Label[]>(initialLabels);
  const [cc, setCc] = useState<DocumentCc[]>(initial.cc);
  const [attachments, setAttachments] = useState<DocumentAttachment[]>(initial.attachments);
  const [uploading, setUploading] = useState<string[]>([]);

  const [busy, setBusy] = useState<null | "temp" | "back" | "prepare" | "send" | "schedule">(null);
  const [labelModal, setLabelModal] = useState(false);
  /** 라벨 미설정 → 라벨 설정: continue to 전송 정보 확인 once labels are applied */
  const [resumeSend, setResumeSend] = useState(false);
  const [ccModal, setCcModal] = useState(false);
  const [labelWarn, setLabelWarn] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const days = Number(expires);
  const daysValid = Number.isInteger(days) && days >= 1 && days <= 365;

  function settings(): RequestSettingsInput {
    return {
      title,
      expiresDays: daysValid ? days : initial.expiresDays,
      lockPassword: lockEnabled ? lockPassword : null,
      labelIds,
      cc,
    };
  }

  function localError(): string | null {
    if (!title.trim()) return "문서 제목을 입력해 주세요.";
    if (!daysValid) return "서명 유효 기한은 1일에서 365일 사이로 입력해 주세요.";
    if (lockEnabled && (lockPassword.length < 4 || lockPassword.length > 20)) return "문서 잠금 비밀번호는 4~20자로 입력해 주세요.";
    if (uploading.length) return "첨부파일 업로드가 끝날 때까지 기다려 주세요.";
    return null;
  }

  async function tempSave() {
    const err = localError();
    if (err) return void toast.error(err);
    setBusy("temp");
    const res = await saveRequestSettings(docId, settings());
    setBusy(null);
    if (res.ok) toast.success("임시 저장되었습니다.");
    else toast.error(res.error);
  }

  async function back() {
    if (busy) return;
    setBusy("back");
    if (!localError()) {
      const res = await saveRequestSettings(docId, settings());
      if (!res.ok) toast.error(res.error);
    }
    router.push(`${base}/documents/d/${docId}/steps/2`);
  }

  async function startSend() {
    const err = localError();
    if (err) return void toast.error(err);
    setBusy("prepare");
    const res = await prepareSend(docId, settings());
    setBusy(null);
    if (!res.ok) return void toast.error(res.error);
    if (labelIds.length === 0 && !readSkipLabelWarning()) setLabelWarn(true);
    else setConfirmOpen(true);
  }

  async function doSend() {
    setBusy("send");
    const res = await sendNow(docId, settings());
    if (!res.ok) {
      setBusy(null);
      toast.error(res.error);
      return;
    }
    router.push(`${base}/documents/d/completed?doc=${docId}`);
  }

  async function doSchedule(iso: string) {
    const err = localError();
    if (err) return void toast.error(err);
    setBusy("schedule");
    const res = await scheduleSend(docId, settings(), iso);
    if (!res.ok) {
      setBusy(null);
      toast.error(res.error);
      return;
    }
    router.push(`${base}/documents/d/completed?doc=${docId}`);
  }

  async function uploadFiles(files: File[]) {
    const supabase = createClient();
    let room = MAX_ATTACHMENTS - attachments.length - uploading.length;
    for (const f of files) {
      if (room <= 0) {
        toast.error(`첨부파일은 최대 ${MAX_ATTACHMENTS}개까지 올릴 수 있습니다.`);
        break;
      }
      if (f.size === 0) {
        toast.error(`빈 파일은 첨부할 수 없습니다: ${f.name}`);
        continue;
      }
      if (f.size > MAX_ATTACHMENT_BYTES) {
        toast.error(`첨부파일은 최대 10MB까지 올릴 수 있습니다: ${f.name}`);
        continue;
      }
      room--;
      const ext = (f.name.match(/\.([a-z0-9]{1,10})$/i)?.[1] ?? "bin").toLowerCase();
      const path = `${wid}/documents/${docId}/attachments/${uuid()}.${ext}`;
      const type = f.type || "application/octet-stream";
      setUploading((u) => [...u, f.name]);
      try {
        const { error } = await supabase.storage.from(BUCKET).upload(path, f, { contentType: type, upsert: false });
        if (error) {
          toast.error(/mime|type/i.test(error.message) ? `지원하지 않는 파일 형식입니다: ${f.name}` : `업로드하지 못했습니다: ${f.name}`);
          continue;
        }
        const res = await addAttachment(docId, { name: f.name, path, size: f.size, type });
        if (res.ok) setAttachments(res.attachments);
        else toast.error(res.error);
      } finally {
        setUploading((u) => {
          const i = u.indexOf(f.name);
          return i < 0 ? u : [...u.slice(0, i), ...u.slice(i + 1)];
        });
      }
    }
  }

  async function deleteAttachment(path: string) {
    const res = await removeAttachment(docId, path);
    if (res.ok) setAttachments(res.attachments);
    else toast.error(res.error);
  }

  async function saveCc(next: DocumentCc[]) {
    const res = await saveRequestSettings(docId, { cc: next });
    if (!res.ok) {
      toast.error(res.error);
      return false;
    }
    setCc(next);
    return true;
  }

  async function applyLabels(ids: string[]) {
    const res = await saveRequestSettings(docId, { labelIds: ids });
    if (!res.ok) return void toast.error(res.error);
    setLabelIds(ids);
    setLabelModal(false);
    if (resumeSend) {
      setResumeSend(false);
      setConfirmOpen(true);
    }
  }

  function closeLabelModal() {
    setLabelModal(false);
    setResumeSend(false);
  }

  const selectedLabels = labels.filter((l) => labelIds.includes(l.id));
  const sendBusy = busy === "prepare" || busy === "send" || busy === "schedule";

  return (
    <div className="flex min-h-screen flex-col bg-surface-2">
      <WizardHeader
        onBack={back}
        onTempSave={tempSave}
        primary={
          <Dropdown
            align="right"
            panelClassName="w-40"
            trigger={(open, toggle) => (
              <div className="flex h-[42px] overflow-hidden rounded-md bg-primary text-primary-fg shadow-button">
                <button
                  type="button"
                  onClick={startSend}
                  disabled={sendBusy || busy === "back"}
                  className="flex items-center gap-1.5 px-6 text-base font-medium hover:bg-primary-hover disabled:opacity-70"
                >
                  {busy === "prepare" && <Loader2 className="size-4 animate-spin" />}
                  즉시 전송
                </button>
                <span className="my-2 w-px bg-primary-hover" aria-hidden />
                <button
                  type="button"
                  onClick={toggle}
                  disabled={sendBusy}
                  aria-label="전송 옵션"
                  aria-haspopup="menu"
                  aria-expanded={open}
                  className={cn("flex w-10 items-center justify-center hover:bg-primary-hover disabled:opacity-70", open && "bg-primary-hover")}
                >
                  <ChevronDown className="size-4" />
                </button>
              </div>
            )}
          >
            {(close) => (
              <MenuItem
                icon={<Clock />}
                onClick={() => {
                  close();
                  const err = localError();
                  if (err) return void toast.error(err);
                  setScheduleOpen(true);
                }}
              >
                예약 전송
              </MenuItem>
            )}
          </Dropdown>
        }
      />

      <main className="mx-auto w-full max-w-[732px] flex-1 px-4 pb-24 pt-8">
        <h1 className="sr-only">요청 정보</h1>
        <div className="space-y-[18px]">
        <Section label="문서 정보">
          <div className="px-6 pb-6 pt-6">
            <FilledField label="문서 제목" value={title} onChange={setTitle} maxLength={100} />
          </div>
          <Row
            icon={<Clock />}
            title={`${verb} 유효 기한`}
            desc={`각 ${view ? "열람자" : "서명자"}는 자기 차례가 된 시점부터 ${daysValid ? days : "N"}일 내에 ${verb}해야 합니다. (최대 365일)`}
            control={
              <span className="flex shrink-0 items-center gap-2.5">
                <Input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={365}
                  aria-label={`${verb} 유효 기한 (일)`}
                  value={expires}
                  invalid={!daysValid}
                  onChange={(e) => setExpires(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))}
                  onBlur={() => {
                    const n = Math.round(Number(expires));
                    setExpires(String(Number.isFinite(n) && n >= 1 ? Math.min(365, n) : 14));
                  }}
                  className="h-9 w-[86px] border-line text-right"
                />
                <span className="text-[13px] text-fg-muted">일</span>
              </span>
            }
          />
          <Row
            icon={<Lock />}
            title="완료된 문서 잠금"
            desc="완료된 문서와 PDF를 열 때 비밀번호를 입력하도록 합니다. 비밀번호는 별도로 전달해야 합니다."
            control={<Checkbox checked={lockEnabled} onChange={setLockEnabled} aria-label="완료된 문서 잠금" />}
          >
            {lockEnabled && (
              <div className="max-w-[320px]">
                <Input
                  type="password"
                  autoComplete="new-password"
                  placeholder="잠금 비밀번호 (4~20자)"
                  maxLength={20}
                  value={lockPassword}
                  invalid={lockPassword.length > 0 && lockPassword.length < 4}
                  onChange={(e) => setLockPassword(e.target.value)}
                  className="h-10"
                />
              </div>
            )}
          </Row>
        </Section>

        <Section label="참조">
          <Row
            icon={<Paperclip />}
            title="첨부파일"
            desc={`${view ? "열람자" : "서명자"}에게 함께 전달할 참고 파일을 첨부합니다.`}
            control={
              <SmallButton onClick={() => fileRef.current?.click()} disabled={attachments.length + uploading.length >= MAX_ATTACHMENTS}>
                업로드
              </SmallButton>
            }
          >
            {(attachments.length > 0 || uploading.length > 0) && (
              <ul className="space-y-1.5">
                {attachments.map((a) => (
                  <li key={a.path} className="flex h-10 items-center gap-2.5 rounded border border-line-light bg-surface-3 pl-3 pr-1.5">
                    <FileText className="size-4 shrink-0 text-icon-2" />
                    <span className="min-w-0 flex-1 truncate text-[13px] text-fg" title={a.name}>
                      {a.name}
                    </span>
                    <span className="shrink-0 text-xs text-fg-muted">{bytesLabel(a.size)}</span>
                    <button
                      type="button"
                      aria-label={`${a.name} 삭제`}
                      onClick={() => deleteAttachment(a.path)}
                      className="flex size-7 shrink-0 items-center justify-center rounded text-icon-2 hover:bg-btn-light"
                    >
                      <X className="size-4" />
                    </button>
                  </li>
                ))}
                {uploading.map((n, i) => (
                  <li key={`${n}-${i}`} className="flex h-10 items-center gap-2.5 rounded border border-line-light bg-surface-3 px-3 text-[13px] text-fg-muted">
                    <Loader2 className="size-4 shrink-0 animate-spin" />
                    <span className="truncate">{n}</span>
                    <span className="ml-auto shrink-0 text-xs">업로드 중…</span>
                  </li>
                ))}
              </ul>
            )}
          </Row>
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              if (files.length) void uploadFiles(files);
            }}
          />
          <Row
            icon={<Users />}
            title="외부 참조자"
            desc="문서 시작·완료 시 알림을 받을 참조자를 지정합니다."
            control={<SmallButton onClick={() => setCcModal(true)}>설정</SmallButton>}
          >
            {cc.length > 0 && (
              <ul className="flex flex-wrap gap-1.5">
                {cc.map((c) => (
                  <li key={c.email} className="inline-flex h-7 items-center rounded-full border border-line-light bg-surface-4 px-2.5 text-[13px] text-fg-2">
                    <span className="font-semibold text-fg">{c.name}</span>
                    <span className="ml-1.5 text-fg-muted">{c.email}</span>
                  </li>
                ))}
              </ul>
            )}
          </Row>
        </Section>

        <Section label="문서 관리">
          <Row icon={<Tag />} title="라벨" desc="문서를 분류할 라벨을 지정합니다." control={<SmallButton onClick={() => setLabelModal(true)}>설정</SmallButton>}>
            {selectedLabels.length > 0 && (
              <ul className="flex flex-wrap gap-1.5">
                {selectedLabels.map((l) => (
                  <li key={l.id} className="inline-flex h-7 items-center gap-1.5 rounded-full border border-line-light bg-surface-4 px-2.5 text-[13px] text-fg">
                    <span className="size-2 rounded-full" style={{ background: l.color }} aria-hidden />
                    {l.name}
                  </li>
                ))}
              </ul>
            )}
          </Row>
          <Row
            icon={<Share2 />}
            title="문서 공유"
            desc={`${verb} 요청 시 문서를 그룹 또는 멤버에게 공유합니다.`}
            control={<SmallButton onClick={() => toast("문서 공유는 준비 중입니다.")}>설정</SmallButton>}
          />
          <Row
            icon={<Bell />}
            title="계약 리마인더"
            desc="갱신·만료·이행 등 중요한 계약 알림을 설정합니다."
            control={<SmallButton onClick={() => toast("계약 리마인더는 준비 중입니다.")}>설정</SmallButton>}
          />
        </Section>
        </div>
      </main>

      {labelModal && (
        <LabelModal
          open
          wid={wid}
          labels={labels}
          selected={labelIds}
          onClose={closeLabelModal}
          onApply={applyLabels}
          onLabelCreated={(l) => setLabels((ls) => [...ls.filter((x) => x.id !== l.id), l].sort((a, b) => a.name.localeCompare(b.name, "ko")))}
        />
      )}
      {ccModal && <CcModal open initial={cc} onClose={() => setCcModal(false)} onSave={saveCc} />}
      {labelWarn && (
        <LabelWarningModal
          open
          onClose={() => setLabelWarn(false)}
          onSendAnyway={(dontShow) => {
            if (dontShow) writeSkipLabelWarning();
            setLabelWarn(false);
            setConfirmOpen(true);
          }}
          onSetLabel={(dontShow) => {
            if (dontShow) writeSkipLabelWarning();
            setLabelWarn(false);
            setResumeSend(true);
            setLabelModal(true);
          }}
        />
      )}
      <SendConfirmModal
        open={confirmOpen}
        view={view}
        rows={participants}
        sending={busy === "send"}
        onClose={() => setConfirmOpen(false)}
        onSend={doSend}
      />
      {scheduleOpen && <ScheduleModal open busy={busy === "schedule"} onClose={() => setScheduleOpen(false)} onSchedule={doSchedule} />}
    </div>
  );
}
