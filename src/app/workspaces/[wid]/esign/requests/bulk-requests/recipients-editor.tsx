"use client";

import { ClipboardPaste, Download, FileUp, Plus, Trash2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import {
  BULK_MAX_RECIPIENTS,
  PERSON_NAME_MAX,
  RECIPIENTS_CSV_TEMPLATE,
  parseRecipientsText,
  validateRecipients,
  type RecipientInput,
} from "@/lib/templates/model";
import { cn } from "@/lib/utils";

export interface RecipientDraft extends RecipientInput {
  key: string;
}

const MAX_CSV_BYTES = 1024 * 1024;
let seq = 0;
export const draftKey = () => `r${Date.now().toString(36)}${(seq++).toString(36)}`;

/** Korean spreadsheets often export CSV as EUC-KR (CP949) — fall back when the bytes are not UTF-8. */
function decodeCsv(buf: ArrayBuffer) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder("euc-kr").decode(buf);
  }
}

const isBlank = (r: RecipientInput) => !r.name.trim() && !r.email.trim();

/** Validation of the non-blank rows → error per row key + the clean list to send. */
export function checkRecipients(rows: RecipientDraft[]) {
  const filled = rows.filter((r) => !isBlank(r));
  const checked = validateRecipients(filled);
  const errors = new Map<string, string>();
  checked.forEach((c, i) => c.error && errors.set(filled[i].key, c.error));
  return { filled, errors, valid: filled.length > 0 && errors.size === 0 && filled.length <= BULK_MAX_RECIPIENTS };
}

/** 수신자 입력: editable rows (이름, 이메일) + CSV upload / paste from a spreadsheet. */
export function RecipientsEditor({ rows, onChange, disabled }: { rows: RecipientDraft[]; onChange: (rows: RecipientDraft[]) => void; disabled?: boolean }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const { filled, errors } = useMemo(() => checkRecipients(rows), [rows]);

  const append = (list: RecipientInput[], source: string) => {
    const incoming = list.filter((r) => !isBlank(r));
    if (incoming.length === 0) {
      toast.error(`${source}에서 수신자를 찾지 못했습니다. 이름, 이메일 순서로 입력해 주세요.`);
      return false;
    }
    const base = rows.filter((r) => !isBlank(r));
    const room = BULK_MAX_RECIPIENTS - base.length;
    if (room <= 0) {
      toast.error(`수신자는 최대 ${BULK_MAX_RECIPIENTS}명까지 추가할 수 있습니다.`);
      return false;
    }
    const added = incoming.slice(0, room).map((r) => ({ key: draftKey(), name: r.name.slice(0, PERSON_NAME_MAX), email: r.email.slice(0, 254) }));
    onChange([...base, ...added]);
    if (incoming.length > room) toast.error(`최대 ${BULK_MAX_RECIPIENTS}명까지만 추가되었습니다. (${incoming.length - room}명 제외)`);
    else toast.success(`수신자 ${added.length}명을 추가했습니다.`);
    return true;
  };

  const loadFile = async (file: File | undefined) => {
    if (!file) return;
    if (!/\.(csv|txt)$/i.test(file.name)) {
      toast.error("CSV 파일(.csv)만 업로드할 수 있습니다.");
      return;
    }
    if (file.size > MAX_CSV_BYTES) {
      toast.error("1MB 이하의 CSV 파일만 업로드할 수 있습니다.");
      return;
    }
    try {
      append(parseRecipientsText(decodeCsv(await file.arrayBuffer())), "파일");
    } catch {
      toast.error("파일을 읽지 못했습니다. 다른 파일로 다시 시도해 주세요.");
    }
  };

  const downloadTemplate = () => {
    const url = URL.createObjectURL(new Blob([RECIPIENTS_CSV_TEMPLATE], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "대량전송_수신자_양식.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const update = (key: string, patch: Partial<RecipientInput>) => onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const remove = (key: string) => onChange(rows.filter((r) => r.key !== key));
  const addRow = () => {
    if (filled.length >= BULK_MAX_RECIPIENTS) {
      toast.error(`수신자는 최대 ${BULK_MAX_RECIPIENTS}명까지 추가할 수 있습니다.`);
      return;
    }
    onChange([...rows, { key: draftKey(), name: "", email: "" }]);
  };

  const toolBtn = "inline-flex h-8 items-center gap-1.5 rounded border border-line-strong bg-btn-light px-2.5 text-[13px] font-medium text-fg-2 transition-colors hover:bg-btn-base disabled:opacity-50";

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" className={toolBtn} onClick={addRow} disabled={disabled}>
          <Plus className="size-3.5" />
          수신자 추가
        </button>
        <button type="button" className={toolBtn} onClick={() => fileRef.current?.click()} disabled={disabled}>
          <FileUp className="size-3.5" />
          CSV 업로드
        </button>
        <button type="button" className={cn(toolBtn, pasteOpen && "bg-btn-base")} onClick={() => setPasteOpen((v) => !v)} disabled={disabled} aria-expanded={pasteOpen}>
          <ClipboardPaste className="size-3.5" />
          붙여넣기
        </button>
        <button type="button" className={toolBtn} onClick={downloadTemplate}>
          <Download className="size-3.5" />
          양식 다운로드
        </button>
        <span className="ml-auto text-[13px] text-fg-muted">
          총 <b className="font-bold text-fg">{filled.length}</b>명 / {BULK_MAX_RECIPIENTS}
          {errors.size > 0 && <span className="ml-2 font-medium text-negative">오류 {errors.size}건</span>}
        </span>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv,.txt"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            void loadFile(f);
          }}
        />
      </div>

      {pasteOpen && (
        <div className="mt-3 rounded-md border border-line-light bg-surface-3 p-3">
          <p className="text-xs text-fg-muted">엑셀·스프레드시트에서 이름과 이메일 열을 복사해 붙여넣으세요. 한 줄에 한 명씩, 이름과 이메일은 쉼표나 탭으로 구분합니다.</p>
          <Textarea
            rows={5}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder={"홍길동, hong@example.com\n김예시, kim@example.com"}
            aria-label="수신자 붙여넣기"
            className="mt-2 font-mono text-[13px]"
          />
          <div className="mt-2 flex justify-end gap-1.5">
            <Button variant="light" size="sm" onClick={() => setPasteOpen(false)}>
              닫기
            </Button>
            <Button
              variant="neutral"
              size="sm"
              disabled={!pasteText.trim()}
              onClick={() => {
                if (append(parseRecipientsText(pasteText), "붙여넣은 내용")) {
                  setPasteText("");
                  setPasteOpen(false);
                }
              }}
            >
              목록에 추가
            </Button>
          </div>
        </div>
      )}

      <div className="mt-3 overflow-hidden rounded-md border border-line">
        <div className="flex h-9 items-center border-b border-line bg-surface-3 px-3 text-xs text-fg-faint" role="row">
          <span className="w-10 shrink-0">#</span>
          <span className="w-[200px] shrink-0 px-1">이름</span>
          <span className="flex-1 px-1">이메일</span>
          <span className="w-8 shrink-0" aria-hidden />
        </div>
        <div className="max-h-[300px] overflow-y-auto">
          {rows.length === 0 ? (
            <p className="px-4 py-10 text-center text-[13px] text-fg-muted">
              수신자를 추가하거나 CSV 파일을 업로드하세요.
              <br />
              수신자마다 문서가 하나씩 만들어져 서명 요청이 전송됩니다.
            </p>
          ) : (
            rows.map((r, i) => {
              const err = errors.get(r.key);
              return (
                <div key={r.key} className="border-b border-line-light px-3 py-1.5 last:border-b-0" role="row">
                  <div className="flex items-center">
                    <span className="w-10 shrink-0 text-xs text-fg-muted">{i + 1}</span>
                    <div className="w-[200px] shrink-0 px-1">
                      <Input
                        value={r.name}
                        maxLength={PERSON_NAME_MAX}
                        placeholder="이름"
                        aria-label={`${i + 1}번째 수신자 이름`}
                        invalid={!!err && !r.name.trim()}
                        disabled={disabled}
                        className="h-8"
                        onChange={(e) => update(r.key, { name: e.target.value })}
                      />
                    </div>
                    <div className="flex-1 px-1">
                      <Input
                        value={r.email}
                        type="email"
                        inputMode="email"
                        maxLength={254}
                        placeholder="이메일"
                        aria-label={`${i + 1}번째 수신자 이메일`}
                        invalid={!!err && !!r.name.trim()}
                        disabled={disabled}
                        className="h-8"
                        onChange={(e) => update(r.key, { email: e.target.value })}
                      />
                    </div>
                    <button
                      type="button"
                      aria-label={`${i + 1}번째 수신자 삭제`}
                      title="삭제"
                      disabled={disabled}
                      onClick={() => remove(r.key)}
                      className="flex size-8 shrink-0 items-center justify-center rounded text-fg-faint hover:bg-btn-light hover:text-fg-2"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                  {err && <p className="ml-10 mt-0.5 px-1 text-xs text-negative">{err}</p>}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
