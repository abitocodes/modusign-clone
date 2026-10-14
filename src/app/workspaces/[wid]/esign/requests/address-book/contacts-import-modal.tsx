"use client";

import { CircleCheck, Download, FileSpreadsheet, Upload, X } from "lucide-react";
import { useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { CONTACT_LIMITS, CONTACTS_CSV_TEMPLATE, parseContactsImport } from "@/lib/tools/contacts";
import type { Contact } from "@/lib/types";
import { cn } from "@/lib/utils";

import { importContacts } from "./actions";

const MAX_CSV_BYTES = 1024 * 1024;

/** Korean spreadsheets often export CSV as EUC-KR (CP949) — fall back when the bytes are not valid UTF-8. */
function decodeCsv(buf: ArrayBuffer) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder("euc-kr").decode(buf);
  }
}

/** 여러 개 일괄 추가 — paste CSV text or upload a .csv file (이름,휴대폰,이메일,회사명). */
export function ContactsImportModal({
  wid,
  existing,
  onClose,
}: {
  wid: string;
  existing: Pick<Contact, "name" | "email" | "phone">[];
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const rows = useMemo(() => (text.trim() ? parseContactsImport(text, existing) : []), [text, existing]);
  const validRows = rows.filter((r) => r.values);
  const errorCount = rows.length - validRows.length;
  const tooMany = validRows.length > CONTACT_LIMITS.importRows;

  const close = () => {
    if (!pending) onClose();
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
      setText(decodeCsv(await file.arrayBuffer()));
      setFileName(file.name);
    } catch {
      toast.error("파일을 읽지 못했습니다. 다른 파일로 다시 시도해 주세요.");
    }
  };

  const downloadTemplate = () => {
    const url = URL.createObjectURL(new Blob([CONTACTS_CSV_TEMPLATE], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "주소록_일괄추가_양식.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const submit = () => {
    if (validRows.length === 0 || tooMany || pending) return;
    startTransition(async () => {
      const res = await importContacts(
        wid,
        validRows.map((r) => ({ name: r.name, phone: r.phone, email: r.email, company: r.company })),
      );
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`연락처 ${res.count}개를 추가했습니다.`);
      onClose();
    });
  };

  return (
    <Modal
      open
      onClose={close}
      width={760}
      icon={<FileSpreadsheet />}
      title="여러 개 일괄 추가"
      footer={
        <>
          <Button variant="light" className="min-w-[60px] font-bold" onClick={close} disabled={pending}>
            취소
          </Button>
          <Button variant="primary" className="min-w-[60px]" onClick={submit} disabled={validRows.length === 0 || tooMany || pending}>
            {pending ? "추가 중…" : validRows.length > 0 ? `${validRows.length}개 추가` : "추가"}
          </Button>
        </>
      }
    >
      <div className="px-[30px] pb-2 pt-6">
        <div className="flex items-start justify-between gap-4 rounded-md border border-line-light bg-surface-3 px-4 py-3">
          <div className="text-[13px] leading-relaxed text-fg-2">
            <p>
              CSV 파일을 업로드하거나 내용을 붙여넣으세요. 열 순서는{" "}
              <b className="font-bold text-fg">이름, 휴대폰, 이메일, 회사명</b>입니다.
            </p>
            <p className="text-fg-muted">
              첫 줄의 머리글은 자동으로 건너뛰며, 휴대폰 또는 이메일 중 하나는 꼭 입력해야 합니다. (최대 {CONTACT_LIMITS.importRows}개)
            </p>
          </div>
          <Button variant="outline" size="sm" icon={<Download className="size-3.5" />} onClick={downloadTemplate}>
            양식 다운로드
          </Button>
        </div>

        <div
          className={cn("relative mt-4 rounded-md", dragOver && "ring-2 ring-emphasis")}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            void loadFile(e.dataTransfer.files?.[0]);
          }}
        >
          <div className="mb-2 flex items-center justify-between">
            <label htmlFor="contacts-csv-text" className="text-sm font-medium text-fg">
              연락처 내용
            </label>
            <div className="flex items-center gap-2">
              {fileName && (
                <span className="inline-flex max-w-[260px] items-center gap-1 rounded-full border border-line-strong bg-surface-4 py-0.5 pl-2.5 pr-1 text-xs text-fg-2">
                  <span className="truncate">{fileName}</span>
                  <button
                    type="button"
                    aria-label="파일 지우기"
                    className="flex size-4 items-center justify-center rounded-full hover:bg-btn-hover"
                    onClick={() => {
                      setFileName(null);
                      setText("");
                    }}
                  >
                    <X className="size-3" />
                  </button>
                </span>
              )}
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  void loadFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              <Button variant="outline" size="sm" icon={<Upload className="size-3.5" />} onClick={() => fileRef.current?.click()}>
                CSV 파일 선택
              </Button>
            </div>
          </div>
          <Textarea
            id="contacts-csv-text"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setFileName(null);
            }}
            spellCheck={false}
            placeholder={"이름,휴대폰,이메일,회사명\n홍길동,010-1234-5678,hong@example.com,예시회사"}
            className="h-[120px] text-[13px]"
          />
        </div>

        <div className="mt-5">
          <div className="flex items-center gap-3 text-[13px]">
            <span className="font-medium text-fg">미리보기</span>
            <span className="text-fg-muted">전체 {rows.length}개</span>
            <span className="text-positive">추가 가능 {validRows.length}개</span>
            {errorCount > 0 && <span className="text-negative">오류 {errorCount}개</span>}
            {tooMany && <span className="text-negative">한 번에 최대 {CONTACT_LIMITS.importRows}개까지 추가할 수 있습니다.</span>}
          </div>
          <div className="mt-2 max-h-[260px] overflow-auto rounded-md border border-line-light">
            <table className="w-full table-fixed text-left text-[13px]">
              <thead className="sticky top-0 bg-surface-3 text-fg-faint">
                <tr>
                  <th className="w-12 px-3 py-2 font-normal">행</th>
                  <th className="w-[110px] px-3 py-2 font-normal">이름</th>
                  <th className="w-[130px] px-3 py-2 font-normal">휴대폰</th>
                  <th className="px-3 py-2 font-normal">이메일</th>
                  <th className="w-[110px] px-3 py-2 font-normal">회사명</th>
                  <th className="w-[150px] px-3 py-2 font-normal">확인</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-fg-muted">
                      CSV 내용을 입력하면 추가될 연락처를 미리 볼 수 있습니다.
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.line} className={cn("border-t border-line-light", r.error && "bg-negative-bg/40")}>
                      <td className="px-3 py-2 text-fg-faint">{r.line}</td>
                      <td className="truncate px-3 py-2 text-fg">{r.values?.name ?? r.name}</td>
                      <td className="truncate px-3 py-2 text-fg-2">{r.values?.phone ?? r.phone}</td>
                      <td className="truncate px-3 py-2 text-fg-2">{r.values?.email ?? r.email}</td>
                      <td className="truncate px-3 py-2 text-fg-2">{r.values?.company ?? r.company}</td>
                      <td className="px-3 py-2">
                        {r.error ? (
                          <span className="text-xs leading-snug text-negative">{r.error}</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-positive">
                            <CircleCheck className="size-3.5" />
                            추가 가능
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Modal>
  );
}
